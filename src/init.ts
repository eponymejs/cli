import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { resolveMigrationsAsset, resolveSchemaAsset } from './assets.js'
import {
  EPONYME_MODEL_NAMES,
  EPONYME_SCHEMA_MARKER_END,
  EPONYME_SCHEMA_MARKER_START,
} from './schema.js'

export interface InitOptions {
  cwd?: string
  schema?: string
  migrations?: string
  force?: boolean
}

export interface InitResult {
  schemaPath: string
  migrationsPath: string
  schemaAction: 'added' | 'updated' | 'unchanged'
  copiedMigrations: string[]
  existingMigrations: string[]
}

interface FileToCopy {
  source: string
  destination: string
  relativePath: string
  content: string
  exists: boolean
}

function findModelRange(source: string, modelName: string) {
  const match = new RegExp(`(^|\\n)model\\s+${modelName}\\s*\\{`, 'm').exec(source)

  if (!match)
    return undefined

  const start = match.index + (match[1] ? 1 : 0)
  const openBrace = source.indexOf('{', start)
  let depth = 0
  let inString = false
  let inComment = false

  // Braces inside a string or a comment are text, not structure: `note String @default("}")` is a valid
  // field, and counting its brace would cut the model in half.
  for (let index = openBrace; index < source.length; index++) {
    const character = source[index]

    if (inComment) {
      if (character === '\n')
        inComment = false
      continue
    }
    if (inString) {
      if (character === '\\')
        index++
      else if (character === '"')
        inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '/' && source[index + 1] === '/') {
      inComment = true
      continue
    }

    if (character === '{')
      depth++
    else if (character === '}')
      depth--

    if (depth === 0)
      return { start, end: index + 1 }
  }

  throw new Error(`The Prisma model ${modelName} has no closing brace.`)
}

function removeModels(source: string) {
  const ranges = EPONYME_MODEL_NAMES
    .map(modelName => findModelRange(source, modelName))
    .filter(range => range !== undefined)
    .sort((left, right) => right.start - left.start)

  return ranges.reduce(
    (result, range) => `${result.slice(0, range.start)}${result.slice(range.end)}`,
    source,
  ).trimEnd()
}

function renderManagedSchema(schema: string) {
  return `${EPONYME_SCHEMA_MARKER_START}\n${schema.trim()}\n${EPONYME_SCHEMA_MARKER_END}`
}

function updateSchema(source: string, schema: string, force: boolean) {
  const managedSchema = renderManagedSchema(schema)
  const markerStart = source.indexOf(EPONYME_SCHEMA_MARKER_START)
  const markerEnd = source.indexOf(EPONYME_SCHEMA_MARKER_END)

  if (markerStart !== -1 || markerEnd !== -1) {
    if (markerStart === -1 || markerEnd === -1 || markerEnd < markerStart)
      throw new Error('The Prisma schema contains an incomplete Eponyme managed block.')

    const end = markerEnd + EPONYME_SCHEMA_MARKER_END.length
    const next = `${source.slice(0, markerStart)}${managedSchema}${source.slice(end)}`
    return { content: next, action: next === source ? 'unchanged' : 'updated' } as const
  }

  const existingModels = EPONYME_MODEL_NAMES.filter(modelName => findModelRange(source, modelName))

  if (existingModels.length > 0 && !force) {
    throw new Error(
      `The Prisma schema already contains unmanaged Eponyme models (${existingModels.join(', ')}). `
      + 'Run again with --force to replace only those models with the version managed by Eponyme.',
    )
  }

  const base = force ? removeModels(source) : source.trimEnd()
  const content = `${base}\n\n${managedSchema}\n`

  return { content, action: existingModels.length > 0 ? 'updated' : 'added' } as const
}

async function collectMigrationFiles(sourceRoot: string, destinationRoot: string) {
  const files: FileToCopy[] = []

  async function visit(relativeDirectory: string) {
    const sourceDirectory = join(sourceRoot, relativeDirectory)
    const entries = await readdir(sourceDirectory, { withFileTypes: true })

    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name)

      if (entry.isDirectory()) {
        await visit(relativePath)
        continue
      }

      const source = join(sourceRoot, relativePath)
      const destination = join(destinationRoot, relativePath)
      const content = await readFile(source, 'utf8')
      let destinationContent: string | undefined

      try {
        destinationContent = await readFile(destination, 'utf8')
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }

      if (destinationContent !== undefined && destinationContent !== content) {
        throw new Error(
          `Migration ${relativePath} already exists with different contents. `
          + 'Eponyme will not overwrite migration history.',
        )
      }

      files.push({
        source,
        destination,
        relativePath,
        content,
        exists: destinationContent !== undefined,
      })
    }
  }

  await visit('')
  return files
}

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const schemaPath = resolve(cwd, options.schema ?? 'prisma/schema.prisma')
  const migrationsPath = resolve(cwd, options.migrations ?? 'prisma/migrations')
  const schemaTemplate = await readFile(resolveSchemaAsset(), 'utf8')
  const currentSchema = await readFile(schemaPath, 'utf8')
  const nextSchema = updateSchema(currentSchema, schemaTemplate, options.force ?? false)
  const migrationFiles = await collectMigrationFiles(resolveMigrationsAsset(), migrationsPath)

  if (nextSchema.content !== currentSchema)
    await writeFile(schemaPath, nextSchema.content, 'utf8')

  for (const migration of migrationFiles) {
    if (migration.exists)
      continue

    await mkdir(dirname(migration.destination), { recursive: true })
    await writeFile(migration.destination, migration.content, 'utf8')
  }

  return {
    schemaPath,
    migrationsPath,
    schemaAction: nextSchema.action,
    copiedMigrations: migrationFiles.filter(file => !file.exists).map(file => file.relativePath),
    existingMigrations: migrationFiles.filter(file => file.exists).map(file => file.relativePath),
  }
}
