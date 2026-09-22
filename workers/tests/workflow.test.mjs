import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { executeJob } from '../polled.mjs'
import { checkoutRepository, verifiedRevision } from '../repository.mjs'
import { job, fixture, fixtureRunner } from './helpers.mjs'

test('command workflow clones exact SHA, verifies actual test script and never pushes', async () => {
  const source = await fixture(); const calls = []; const states = []
  const result = await executeJob(job({ base_sha: source.sha, checks: ['smoke', 'test'] }), {
    cwd: source.checkout, run: fixtureRunner(source, calls), write: async state => states.push(state),
  })
  assert.equal(result.state, 'succeeded')
  assert.equal(result.result_sha, source.sha)
  assert.equal(states[0].state, 'running')
  assert.equal(states.at(-1).state, 'succeeded')
  assert.ok(calls.some(call => call.command === 'npm' && call.args.join(' ') === 'run test'))
  assert.ok(!calls.some(call => call.args.includes('push') || ['claude', 'codex'].includes(call.command)))
})

test('failed verification remains failed and cannot publish a result', async () => {
  const source = await fixture({ test: 'node -e "process.exit(7)"' }); const calls = []
  const result = await executeJob(job({ base_sha: source.sha, checks: ['test'] }), {
    cwd: source.checkout, run: fixtureRunner(source, calls), write: async () => {},
  })
  assert.equal(result.state, 'failed')
  assert.match(result.error_message, /Verification test failed/)
  assert.equal(result.result_sha, null)
  assert.ok(!calls.some(call => call.args.includes('push')))
})

test('unexpected fetched SHA fails before setup or checks', async () => {
  const source = await fixture(); const calls = []
  const result = await executeJob(job(), { cwd: source.checkout, run: fixtureRunner(source, calls), write: async () => {} })
  assert.equal(result.state, 'failed')
  assert.match(result.error_message, /pinned SHA/)
  assert.ok(!calls.some(call => call.command === 'npm'))
})

test('missing package check is a failure instead of a skipped success', async () => {
  const source = await fixture()
  const result = await executeJob(job({ base_sha: source.sha, checks: ['build'] }), {
    cwd: source.checkout, run: fixtureRunner(source), write: async () => {},
  })
  assert.equal(result.state, 'failed')
  assert.match(result.error_message, /script build is missing/)
})

test('command clone credential is dropped before package setup and verification', async () => {
  const source = await fixture(); const calls = []; const underlying = fixtureRunner(source, calls)
  const saved = process.env.MC_FLY_GIT_AUTH_TOKEN
  process.env.MC_FLY_GIT_AUTH_TOKEN = 'test-read-only-clone-credential'
  try {
    const run = async (command, args, options) => {
      if (command === 'npm') assert.equal(process.env.MC_FLY_GIT_AUTH_TOKEN, undefined)
      return underlying(command, args, options)
    }
    run.stop = underlying.stop
    const result = await executeJob(job({ base_sha: source.sha, checks: ['test'] }), {
      cwd: source.checkout, run, write: async () => {},
    })
    assert.equal(result.state, 'succeeded')
    assert.equal(process.env.MC_FLY_GIT_AUTH_TOKEN, undefined)
    const fetch = calls.find(call => call.args.includes('fetch'))
    assert.equal(fetch.env.MC_FLY_GIT_AUTH_TOKEN, 'test-read-only-clone-credential')
    assert.ok(calls.filter(call => call.command === 'npm').every(call => !call.env?.MC_FLY_GIT_AUTH_TOKEN))
  } finally {
    if (saved) process.env.MC_FLY_GIT_AUTH_TOKEN = saved; else delete process.env.MC_FLY_GIT_AUTH_TOKEN
  }
})

test('command verification rejects a changed revision', async () => {
  const source = await fixture(); const run = fixtureRunner(source)
  const leaf = job({ base_sha: source.sha })
  await checkoutRepository(leaf, run, source.checkout)
  await writeFile(path.join(source.checkout, 'result.txt'), 'unexpected edit')
  await run('git', ['add', '-A'], { cwd: source.checkout })
  await run('git', ['commit', '-m', 'Unexpected revision'], { cwd: source.checkout })
  await assert.rejects(verifiedRevision(leaf, run, source.checkout), /changed the pinned revision/)
})
test('uncommissioned LLM runtimes fail before any worker command executes', async () => {
  await assert.rejects(executeJob(job({runtime: 'claude'})), /Only command/)
})
