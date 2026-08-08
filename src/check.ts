import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { extname, resolve } from 'node:path'
import { createJiti } from 'jiti'
import {
  EPONYME_DATABASE_COLUMNS,
  EPONYME_PRISMA_DELEGATES,
  EPONYME_SCHEMA_VERSION,
} from './schema.js'

export interface CheckOptions {
  cwd?: string
  client?: string
  env?: string
}

export interface CheckResult {
  clientPath: string
  delegates: string[]
  tables: string[]
  schemaVersion: number
}

interface ColumnRow {
  tableName: string
  columnName: string
}

interface SchemaVersionRow {
  version: number
}

interface PrismaClientLike {
  [key: string]: unknown
  $queryRawUnsafe<T>(query: string): Promise<T>
  $disconnect?: () => Promise<void>
}

function resolveClientPath(cwd: string, clientPath: string) {
  const path = resolve(cwd, clientPath)

  if (existsSync(path))
    return path

  if (extname(path))
    throw new Error(`Prisma client module not found: ${path}`)

  for (const extension of ['.ts', '.mts', '.js', '.mjs']) {
    if (existsSync(`${path}${extension}`))
      return `${path}${extension}`
  }

  throw new Error(`Prisma client module not found: ${path}`)
}

function loadEnvironment(cwd: string, envPath: string) {
  const path = resolve(cwd, envPath)

  if (!existsSync(path))
    return

  loadEnvFile(path)
}

function isPrismaClient(value: unknown): value is PrismaClientLike {
  return typeof value === 'object'
    && value !== null
    && '$queryRawUnsafe' in value
    && typeof value.$queryRawUnsafe === 'function'
}

export async function checkProject(options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const clientPath = resolveClientPath(cwd, options.client ?? 'server/utils/prisma')
  loadEnvironment(cwd, options.env ?? '.env')

  const jiti = createJiti(import.meta.url, { interopDefault: true })
  const client = await jiti.import<unknown>(clientPath, { default: true })

  if (!isPrismaClient(client)) {
    throw new Error(
      `The default export from ${clientPath} is not an initialised PrismaClient `
      + '(missing $queryRawUnsafe).',
    )
  }

  const errors: string[] = []
  const delegates = EPONYME_PRISMA_DELEGATES.filter((delegate) => {
    const exists = typeof client[delegate] === 'object' && client[delegate] !== null

    if (!exists)
      errors.push(`PrismaClient is missing the ${delegate} model delegate.`)

    return exists
  })

  try {
    const columns = await client.$queryRawUnsafe<ColumnRow[]>(`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `)
    const columnsByTable = new Map<string, Set<string>>()

    for (const column of columns) {
      const tableColumns = columnsByTable.get(column.tableName) ?? new Set<string>()
      tableColumns.add(column.columnName)
      columnsByTable.set(column.tableName, tableColumns)
    }

    for (const [table, expectedColumns] of Object.entries(EPONYME_DATABASE_COLUMNS)) {
      const actualColumns = columnsByTable.get(table)

      if (!actualColumns) {
        errors.push(`PostgreSQL table ${table} is missing.`)
        continue
      }

      for (const column of expectedColumns) {
        if (!actualColumns.has(column))
          errors.push(`PostgreSQL column ${table}.${column} is missing.`)
      }
    }

    let schemaVersion = 0

    if (columnsByTable.has('_eponyme_schema')) {
      const rows = await client.$queryRawUnsafe<SchemaVersionRow[]>(`
        SELECT "version"
        FROM "_eponyme_schema"
        WHERE "key" = 'eponyme'
        LIMIT 1
      `)

      schemaVersion = Number(rows[0]?.version ?? 0)

      if (schemaVersion !== EPONYME_SCHEMA_VERSION) {
        errors.push(
          `Eponyme schema version is ${schemaVersion || 'missing'}; expected ${EPONYME_SCHEMA_VERSION}.`,
        )
      }
    }

    if (errors.length > 0)
      throw new Error(`Eponyme check failed:\n- ${errors.join('\n- ')}`)

    return {
      clientPath,
      delegates: [...delegates],
      tables: Object.keys(EPONYME_DATABASE_COLUMNS),
      schemaVersion,
    }
  }
  finally {
    await client.$disconnect?.()
  }
}
