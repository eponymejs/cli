import { defineCommand } from 'citty'
import { checkProject } from './check.js'
import { initProject } from './init.js'
import { EPONYME_SCHEMA_VERSION } from './schema.js'

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Install the Eponyme models and versioned migrations in a host application.',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Host application directory.',
      default: '.',
    },
    schema: {
      type: 'string',
      description: 'Prisma schema path, relative to cwd.',
      default: 'prisma/schema.prisma',
    },
    migrations: {
      type: 'string',
      description: 'Prisma migrations directory, relative to cwd.',
      default: 'prisma/migrations',
    },
    force: {
      type: 'boolean',
      description: 'Replace existing unmanaged Eponyme model blocks.',
      default: false,
    },
  },
  async run({ args }) {
    const result = await initProject(args)
    console.log(`Eponyme Prisma schema ${result.schemaAction}: ${result.schemaPath}`)
    console.log(`Migration files copied: ${result.copiedMigrations.length}`)
    console.log(`Migration files already present: ${result.existingMigrations.length}`)
    console.log('Next: run your Prisma migration command, then prisma generate and eponyme check.')
  },
})

export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Verify the host PrismaClient, PostgreSQL columns and Eponyme schema version.',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Host application directory.',
      default: '.',
    },
    client: {
      type: 'string',
      description: 'Module whose default export is the initialised PrismaClient.',
      default: 'server/utils/prisma',
    },
    env: {
      type: 'string',
      description: 'Environment file path, relative to cwd.',
      default: '.env',
    },
  },
  async run({ args }) {
    const result = await checkProject(args)
    console.log(`PrismaClient: ${result.delegates.length} Eponyme models available`)
    console.log(`PostgreSQL: ${result.tables.length} Eponyme tables verified`)
    console.log(`Schema version: ${result.schemaVersion} (expected ${EPONYME_SCHEMA_VERSION})`)
    console.log('Eponyme check passed.')
  },
})
