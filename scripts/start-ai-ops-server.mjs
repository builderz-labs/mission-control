#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(scriptDir, '..')
const standaloneRoot = resolve(repoRoot, '.next', 'standalone')

async function syncRuntimeAssets() {
  const staticSource = resolve(repoRoot, '.next', 'static')
  const staticTarget = resolve(standaloneRoot, '.next', 'static')
  const publicSource = resolve(repoRoot, 'public')
  const publicTarget = resolve(standaloneRoot, 'public')

  await mkdir(resolve(standaloneRoot, '.next'), { recursive: true })

  await rm(staticTarget, { recursive: true, force: true })
  await cp(staticSource, staticTarget, { recursive: true })

  await rm(publicTarget, { recursive: true, force: true })
  await cp(publicSource, publicTarget, { recursive: true })
}

process.env.HOSTNAME ||= '127.0.0.1'
process.env.PORT ||= '3000'
process.env.MISSION_CONTROL_DATA_DIR ||= resolve(repoRoot, '.data')
process.env.AI_OPS_ROOT ||= repoRoot

await syncRuntimeAssets()
process.chdir(standaloneRoot)
await import('../.next/standalone/server.js')
