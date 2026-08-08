import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initProject } from '../src/init.js'

const BASE_SCHEMA = `generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
`

async function createProject(schema = BASE_SCHEMA) {
  const cwd = await mkdtemp(join(tmpdir(), 'eponyme-cli-init-'))
  await import('node:fs/promises').then(({ mkdir }) => mkdir(join(cwd, 'prisma'), { recursive: true }))
  await writeFile(join(cwd, 'prisma/schema.prisma'), schema, 'utf8')
  return cwd
}

describe('initProject', () => {
  it('installs a managed schema and immutable migration history idempotently', async () => {
    const cwd = await createProject()

    const first = await initProject({ cwd })
    const second = await initProject({ cwd })
    const schema = await readFile(join(cwd, 'prisma/schema.prisma'), 'utf8')
    const versionMigration = await readFile(
      join(cwd, 'prisma/migrations/20260808010000_add_eponyme_schema_version/migration.sql'),
      'utf8',
    )

    expect(first.schemaAction).toBe('added')
    expect(first.copiedMigrations).toContain(
      '20260808010000_add_eponyme_schema_version/migration.sql',
    )
    expect(second.schemaAction).toBe('unchanged')
    expect(second.copiedMigrations).toEqual([])
    expect(schema).toContain('// <eponyme-schema>')
    expect(schema).toContain('model EponymeSchema')
    expect(versionMigration).toContain('VALUES (\'eponyme\', 1, CURRENT_TIMESTAMP)')
  })

  it('requires force before replacing unmanaged Eponyme models', async () => {
    const cwd = await createProject(`${BASE_SCHEMA}\nmodel Eponyme {\n  name String @id\n}\n`)

    await expect(initProject({ cwd })).rejects.toThrow('unmanaged Eponyme models')

    const result = await initProject({ cwd, force: true })
    const schema = await readFile(join(cwd, 'prisma/schema.prisma'), 'utf8')

    expect(result.schemaAction).toBe('updated')
    expect(schema.match(/model Eponyme \{/g)).toHaveLength(1)
    expect(schema).toContain('scheduledUnpublishAt DateTime?')
  })

  it('does not overwrite a migration with different contents', async () => {
    const cwd = await createProject()
    const migrationDirectory = join(cwd, 'prisma/migrations/20260808010000_add_eponyme_schema_version')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(migrationDirectory, { recursive: true }))
    await writeFile(join(migrationDirectory, 'migration.sql'), '-- changed by host\n', 'utf8')

    await expect(initProject({ cwd })).rejects.toThrow('will not overwrite migration history')

    expect(await readFile(join(cwd, 'prisma/schema.prisma'), 'utf8')).toBe(BASE_SCHEMA)
  })
})
