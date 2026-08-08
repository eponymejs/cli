#!/usr/bin/env node

import { defineCommand, runMain } from 'citty'
import { checkCommand, initCommand } from './commands.js'

const main = defineCommand({
  meta: {
    name: 'eponyme',
    version: '0.1.0',
    description: 'Install and verify Eponyme Prisma persistence.',
  },
  subCommands: {
    init: initCommand,
    check: checkCommand,
  },
})

runMain(main)
