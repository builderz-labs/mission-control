#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(scriptDir, '..')

process.env.HOSTNAME ||= '127.0.0.1'
process.env.PORT ||= '3000'
process.env.MISSION_CONTROL_DATA_DIR ||= resolve(repoRoot, '.data')

await import('../.next/standalone/server.js')
