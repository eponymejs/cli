import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(cliRoot, '../..')
const workspace = await mkdtemp(join(tmpdir(), 'eponyme-tarball-'))
const packs = join(workspace, 'packs')
const host = join(workspace, 'host')

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env })
}

await mkdir(packs)
await mkdir(join(host, 'app'), { recursive: true })
await mkdir(join(host, 'prisma'), { recursive: true })
await mkdir(join(host, 'server/utils'), { recursive: true })

try {
  run('pnpm', ['pack', '--pack-destination', packs], repositoryRoot)
  run('pnpm', ['pack', '--pack-destination', packs], cliRoot)

  const tarballs = await readdir(packs)
  const moduleFile = tarballs.find(file => file.startsWith('karibsen-eponyme-'))
  const cliFile = tarballs.find(file => file.startsWith('eponyme-cli-'))

  if (!moduleFile || !cliFile)
    throw new Error(`Expected module and CLI tarballs, received: ${tarballs.join(', ')}`)

  const moduleTarball = join(packs, moduleFile)
  const cliTarball = join(packs, cliFile)

  await writeFile(join(host, 'package.json'), JSON.stringify({
    name: 'eponyme-tarball-host',
    private: true,
    type: 'module',
    dependencies: {
      '@karibsen/eponyme': `file:${moduleTarball}`,
      '@eponyme/cli': `file:${cliTarball}`,
      '@iconify-json/mingcute': '^1.2.7',
      '@prisma/adapter-pg': '^7.9.1',
      '@prisma/client': '^7.9.1',
      'nuxt': '4.5.1',
    },
    devDependencies: {
      prisma: '^7.9.1',
    },
  }, null, 2))
  await writeFile(join(host, 'nuxt.config.ts'), `
export default defineNuxtConfig({
  modules: ['@karibsen/eponyme'],
  eponyme: { prismaClient: '~~/server/utils/prisma' },
})
`.trimStart())
  await writeFile(join(host, 'eponyme.config.ts'), `
import { defineEponymeConfig, field } from '@karibsen/eponyme/config'

export default defineEponymeConfig({
  homepage: { title: field.string({ required: true }) },
})
`.trimStart())
  await writeFile(join(host, 'app/app.vue'), '<template><main>Eponyme tarball host</main></template>\n')
  await writeFile(join(host, 'prisma/schema.prisma'), `
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
`.trimStart())
  await writeFile(join(host, 'prisma.config.ts'), `
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
})
`.trimStart())
  await writeFile(join(host, 'server/utils/prisma.ts'), `
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'

const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/eponyme'
export default new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
`.trimStart())

  run('pnpm', ['install', '--no-frozen-lockfile'], host)
  run('pnpm', ['exec', 'eponyme', 'init'], host)
  run('pnpm', ['exec', 'prisma', 'generate'], host)
  run('pnpm', ['exec', 'nuxt', 'prepare'], host)
  run('pnpm', ['exec', 'nuxt', 'build'], host)

  await access(join(host, 'node_modules/@eponyme/cli/prisma/schema.prisma'))
  await access(join(host, 'prisma/migrations/20260808010000_add_eponyme_schema_version/migration.sql'))
  console.log('Published tarballs installed and built in a blank Nuxt application.')
}
finally {
  await rm(workspace, { recursive: true, force: true })
}
