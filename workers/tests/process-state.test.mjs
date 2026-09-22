import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanEnvironment, createRunner, retry } from '../process.mjs'
import { createStateWriter } from '../state.mjs'

test('command environment excludes model, Git, Doppler and job secrets', () => {
  const env = cleanEnvironment({ PATH: '/usr/bin', HOME: '/home/worker', ANTHROPIC_API_KEY: 'fake',
    OPENAI_API_KEY: 'fake', MC_FLY_GIT_AUTH_TOKEN: 'fake', DOPPLER_TOKEN: 'fake', MC_FLY_JOB_TOKEN: 'fake' })
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.GIT_AUTHOR_NAME, 'Mission Control Fly Worker')
  assert.equal(env.GIT_AUTHOR_EMAIL, 'fly-worker@mission-control.local')
  assert.equal(env.GIT_COMMITTER_NAME, 'Mission Control Fly Worker')
  assert.equal(env.GIT_COMMITTER_EMAIL, 'fly-worker@mission-control.local')
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MC_FLY_GIT_AUTH_TOKEN', 'DOPPLER_TOKEN', 'MC_FLY_JOB_TOKEN']) {
    assert.equal(env[key], undefined)
  }
})

test('runner sends bounded stdin and captures output', async () => {
  const run = createRunner(Date.now() + 5000)
  assert.equal(await run(process.execPath, ['-e', 'process.stdin.on("data", d => process.stdout.write(d))'], { input: 'hello' }), 'hello')
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(2)'], { label: 'Check' }), /Check failed \(exit 2\)/)
})

test('runner kills hanging process groups and rejects exhausted deadlines', async () => {
  const run = createRunner(Date.now() + 200)
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)']), /deadline/)
  await assert.rejects(run(process.execPath, ['--version']), /deadline/)
})

test('successful commands cannot leave a background child running', async () => {
  const run = createRunner(Date.now() + 3000)
  const program = 'const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(c.pid); c.unref()'
  const pid = Number(await run(process.execPath, ['-e', program]))
  assert.ok(Number.isInteger(pid) && pid > 0)
  let alive = true
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { process.kill(pid, 0) } catch { alive = false; break }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(alive, false)
  } finally {
    if (alive) { try { process.kill(pid, 'SIGKILL') } catch { /* Already reaped. */ } }
  }
})

test('network retry is bounded to one repeat', async () => {
  let attempts = 0
  assert.equal(await retry(async () => { if (++attempts === 1) throw new Error('transient'); return 'ok' }, 'git', []), 'ok')
  assert.equal(attempts, 2)
  attempts = 0
  await assert.rejects(retry(async () => { attempts++; throw new Error('outage') }, 'git', []), /outage/)
  assert.equal(attempts, 2)
})

test('state writes are atomic, serialized, private, and terminal remains latest', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mc-state-test.'))
  const file = path.join(directory, 'state.json'); const write = createStateWriter(file)
  const empty = { branch_name: 'mc/fly-task-12-abcd1234', result_sha: null, error_message: null, resolution: null }
  await Promise.all([write({ ...empty, job_id: 'test', state: 'running' }), write({ ...empty, job_id: 'test', state: 'succeeded', result_sha: 'a'.repeat(40) })])
  const result = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(result.state, 'succeeded')
  assert.equal(result.error_message, null)
  assert.equal(result.resolution, null)
  assert.equal(typeof result.updated_at, 'number')
  for (const key of ['cpu_percent', 'memory_bytes', 'swap_bytes']) {
    assert.ok(result[key] === undefined || result[key] >= 0)
  }
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(directory), ['state.json'])
})

