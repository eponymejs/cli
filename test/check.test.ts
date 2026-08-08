import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkProject } from '../src/check.js'
import { EPONYME_DATABASE_COLUMNS, EPONYME_PRISMA_DELEGATES, EPONYME_SCHEMA_VERSION } from '../src/schema.js'

function createClientModule(version = EPONYME_SCHEMA_VERSION, omittedDelegate?: string) {
  const delegates = EPONYME_PRISMA_DELEGATES
    .filter(delegate => delegate !== omittedDelegate)
    .map(delegate => `${delegate}: {}`)
    .join(',\n')
  const columns = Object.entries(EPONYME_DATABASE_COLUMNS).flatMap(([tableName, tableColumns]) =>
    tableColumns.map(columnName => ({ tableName, columnName })),
  )

  return `
const columns = ${JSON.stringify(columns)}
export default {
  ${delegates},
  async $queryRawUnsafe(query) {
    if (query.includes('information_schema.columns')) return columns
    if (query.includes('FROM "_eponyme_schema"')) return [{ version: ${version} }]
    throw new Error('Unexpected query')
  },
  async $disconnect() {},
}
`
}

async function writeClient(source: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'eponyme-cli-check-'))
  const clientPath = join(cwd, 'prisma-client.mjs')
  await writeFile(clientPath, source, 'utf8')
  return { cwd, clientPath }
}

describe('checkProject', () => {
  it('checks delegates, PostgreSQL columns and the schema version', async () => {
    const { cwd, clientPath } = await writeClient(createClientModule())

    const result = await checkProject({ cwd, client: clientPath })

    expect(result.delegates).toHaveLength(EPONYME_PRISMA_DELEGATES.length)
    expect(result.tables).toEqual(Object.keys(EPONYME_DATABASE_COLUMNS))
    expect(result.schemaVersion).toBe(EPONYME_SCHEMA_VERSION)
  })

  it('reports a stale client and database schema version together', async () => {
    const { cwd, clientPath } = await writeClient(createClientModule(0, 'eponymeSchema'))

    await expect(checkProject({ cwd, client: clientPath })).rejects.toThrow(
      new RegExp(`missing the eponymeSchema model delegate[\\s\\S]*expected ${EPONYME_SCHEMA_VERSION}`),
    )
  })
})
