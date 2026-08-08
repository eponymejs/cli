import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { initProject } from '../dist/index.mjs'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prismaBin = join(cliRoot, 'node_modules/.bin/prisma')
const cliBin = join(cliRoot, 'dist/cli.mjs')
let baseUrl = process.env.DATABASE_URL

if (!baseUrl && process.env.EPONYME_POSTGRES_CONTAINER) {
  const output = execFileSync(
    'docker',
    ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', process.env.EPONYME_POSTGRES_CONTAINER],
    { encoding: 'utf8' },
  )
  const environment = new Map(output.trim().split('\n').map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
  const url = new URL('postgresql://127.0.0.1:5432/postgres')
  url.username = environment.get('POSTGRES_USER') ?? 'postgres'
  url.password = environment.get('POSTGRES_PASSWORD') ?? ''
  url.pathname = `/${environment.get('POSTGRES_DB') ?? 'postgres'}`
  baseUrl = url.toString()
}

if (!baseUrl) {
  throw new Error(
    'DATABASE_URL or EPONYME_POSTGRES_CONTAINER is required for the PostgreSQL integration test.',
  )
}

function databaseUrl(name) {
  const url = new URL(baseUrl)
  url.pathname = `/${name}`
  url.search = ''
  return url.toString()
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  })
}

async function createDatabase(admin, name) {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.query(`CREATE DATABASE "${name}"`)
}

async function createHost(name) {
  const cwd = await mkdtemp(join(cliRoot, `.postgres-${name}-`))
  await mkdir(join(cwd, 'prisma'), { recursive: true })
  await mkdir(join(cwd, 'server/utils'), { recursive: true })
  await writeFile(join(cwd, 'prisma/schema.prisma'), `
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
`.trimStart())
  await writeFile(join(cwd, 'prisma.config.ts'), `
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
})
`.trimStart())
  await writeFile(join(cwd, 'server/utils/prisma.ts'), `
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

export default new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})
`.trimStart())
  await initProject({ cwd })
  return cwd
}

function prisma(cwd, args, url) {
  run(prismaBin, [...args, '--config', join(cwd, 'prisma.config.ts')], {
    cwd,
    env: { DATABASE_URL: url },
  })
}

function check(cwd, url) {
  run(process.execPath, [cliBin, 'check', '--cwd', cwd, '--client', 'server/utils/prisma.ts'], {
    cwd,
    env: { DATABASE_URL: url },
  })
}

async function testFreshDatabase(admin, name) {
  await createDatabase(admin, name)
  const cwd = await createHost('fresh')
  const url = databaseUrl(name)

  try {
    prisma(cwd, ['generate'], url)
    prisma(cwd, ['migrate', 'deploy'], url)
    check(cwd, url)
  }
  finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

async function testUpgradeDatabase(admin, name) {
  await createDatabase(admin, name)
  const cwd = await createHost('upgrade')
  const url = databaseUrl(name)
  const migrationsRoot = join(cwd, 'prisma/migrations')
  const pendingRoot = join(cwd, 'pending-migrations')
  const cutoff = '20260719015000_backfill_eponyme_versions'
  await mkdir(pendingRoot)

  try {
    const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    const pending = migrations.filter(migration => migration > cutoff)

    for (const migration of pending)
      await rename(join(migrationsRoot, migration), join(pendingRoot, migration))

    prisma(cwd, ['migrate', 'deploy'], url)

    const database = new Client({ connectionString: url })
    await database.connect()
    await database.query(`
      INSERT INTO "eponyme_entries" ("name", "data", "createdAt", "updatedAt")
      VALUES (
        'homepage',
        '{"__eponyme":{"draft":{"title":"New draft"},"published":{"title":"Legacy published"},"status":"published","publishedAt":"2026-07-01T10:00:00.000Z"}}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `)
    await database.end()

    for (const migration of pending)
      await rename(join(pendingRoot, migration), join(migrationsRoot, migration))

    prisma(cwd, ['migrate', 'deploy'], url)
    prisma(cwd, ['generate'], url)
    check(cwd, url)

    const upgraded = new Client({ connectionString: url })
    await upgraded.connect()
    const content = await upgraded.query(`
      SELECT "draft"->>'title' AS "draftTitle", "published"->>'title' AS "publishedTitle"
      FROM "eponyme_entries"
      WHERE "name" = 'homepage'
    `)
    const version = await upgraded.query(`
      SELECT "version" FROM "_eponyme_schema" WHERE "key" = 'eponyme'
    `)
    await upgraded.end()

    if (content.rows[0]?.draftTitle !== 'New draft')
      throw new Error('The upgrade did not preserve the legacy draft content.')
    if (content.rows[0]?.publishedTitle !== 'Legacy published')
      throw new Error('The upgrade did not preserve the legacy published content.')
    if (version.rows[0]?.version !== 2)
      throw new Error('The upgrade did not register Eponyme schema version 2.')
  }
  finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

const adminUrl = new URL(baseUrl)
adminUrl.pathname = '/postgres'
adminUrl.search = ''
const admin = new Client({ connectionString: adminUrl.toString() })
const suffix = process.pid
const freshDatabase = `eponyme_cli_fresh_${suffix}`
const upgradeDatabase = `eponyme_cli_upgrade_${suffix}`

await admin.connect()

try {
  await testFreshDatabase(admin, freshDatabase)
  await testUpgradeDatabase(admin, upgradeDatabase)
  console.log('Fresh PostgreSQL migration and legacy upgrade checks passed.')
}
finally {
  await admin.query(`DROP DATABASE IF EXISTS "${freshDatabase}" WITH (FORCE)`)
  await admin.query(`DROP DATABASE IF EXISTS "${upgradeDatabase}" WITH (FORCE)`)
  await admin.end()
}
