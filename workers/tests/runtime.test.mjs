import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { packageManager, setupRepository, verifyChecks } from '../runtime.mjs'
import { fixture, job } from './helpers.mjs'

test('setup profiles require lockfiles and pnpm uses frozen installs', async () => {
  const source = await fixture(); const calls = []
  const run = async (command, args, options) => { calls.push({ command, args, options }); return '' }
  await assert.rejects(setupRepository(job({ setup: 'pnpm-ci' }), run, source.checkout), /lockfile/)
  assert.equal(calls.length, 0)
  await writeFile(path.join(source.checkout, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
  assert.equal(await packageManager(job(), source.checkout), 'pnpm')
  await setupRepository(job({ setup: 'pnpm-ci' }), run, source.checkout)
  assert.equal(calls[0].command, 'pnpm')
  assert.deepEqual(calls[0].args, ['install', '--frozen-lockfile'])
})

test('browser setup rejects a core worker before running install', async () => {
  const saved = process.env.MC_FLY_WORKER_CLASS; process.env.MC_FLY_WORKER_CLASS = 'core'
  try {
    let called = false
    await assert.rejects(setupRepository(job({ setup: 'npm-ci-playwright' }), async () => { called = true }, '/tmp'), /browser worker/)
    assert.equal(called, false)
  } finally {
    if (saved) process.env.MC_FLY_WORKER_CLASS = saved; else delete process.env.MC_FLY_WORKER_CLASS
  }
})

test('browser setup runs only installed project Playwright without implicit package download', async () => {
  const source = await fixture(); const calls = []; const saved = process.env.MC_FLY_WORKER_CLASS
  process.env.MC_FLY_WORKER_CLASS = 'browser'
  try {
    await writeFile(path.join(source.checkout, 'package-lock.json'), '{}')
    await setupRepository(job({ setup: 'npm-ci-playwright' }), async (command, args) => { calls.push({ command, args }) }, source.checkout)
    assert.deepEqual(calls.map(call => call.args), [['ci'], ['exec', '--no', '--', 'playwright', 'install', 'chromium']])
  } finally {
    if (saved) process.env.MC_FLY_WORKER_CLASS = saved; else delete process.env.MC_FLY_WORKER_CLASS
  }
})

test('verification ignores arbitrary description commands and executes named package scripts', async () => {
  const source = await fixture({ build: 'node -e "process.exit(0)"' }); const calls = []
  await verifyChecks(job({ description: 'Do not run this arbitrary text', checks: ['build'] }), async (command, args) => { calls.push({ command, args }) }, source.origin)
  assert.deepEqual(calls.map(call => call.args), [['--version'], ['--version'], ['run', 'build']])
})



test('verification supports the bounded repository end-to-end script', async () => {
  const source = await fixture({ 'test:e2e': 'playwright test' }); const calls = []
  await verifyChecks(job({ checks: ['test:e2e'] }), async (command, args) => { calls.push({ command, args }) }, source.origin)
  assert.deepEqual(calls.at(-1).args, ['run', 'test:e2e'])
})

test('browser smoke invokes the bounded Chromium render check', async () => {
  const source = await fixture(); const calls = []
  await verifyChecks(job({ setup: 'pnpm-ci-playwright' }), async (command, args, options) => { calls.push({ command, args, options }) }, source.origin)
  assert.equal(calls.at(-1).command, 'node')
  assert.ok(calls.at(-1).args[0].endsWith('/browser-smoke.mjs'))
  assert.equal(calls.at(-1).options.cwd, source.origin)
})
