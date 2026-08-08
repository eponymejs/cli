import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

let packageRoot: string | undefined

export function resolvePackageRoot() {
  if (packageRoot)
    return packageRoot

  let directory = dirname(fileURLToPath(import.meta.url))
  const root = parse(directory).root

  while (directory !== root) {
    const packagePath = join(directory, 'package.json')

    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string }

      if (packageJson.name === '@eponyme/cli') {
        packageRoot = directory
        return directory
      }
    }

    directory = dirname(directory)
  }

  throw new Error('Unable to locate the @eponyme/cli package assets.')
}

export function resolveSchemaAsset() {
  return join(resolvePackageRoot(), 'prisma', 'schema.prisma')
}

export function resolveMigrationsAsset() {
  return join(resolvePackageRoot(), 'prisma', 'migrations')
}
