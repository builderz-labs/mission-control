import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadJob, validateJob } from '../job.mjs'
import { job } from './helpers.mjs'

test('command tasks validate without any provider credentials', () => {
  const result = validateJob(job({ checks: ['smoke', 'test', 'test'], setup: 'pnpm-ci' }))
  assert.equal(result.runtime, 'command')
  assert.deepEqual(result.checks, ['smoke', 'test'])
})

test('invalid and unbounded jobs fail closed', () => {
  for (const change of [
    { runtime: 'shell' }, { timeout_seconds: 1801 }, { timeout_seconds: 0 }, { timeout_seconds: 2.5 },
    { checks: [] }, { checks: ['arbitrary'] }, { setup: 'npm-install-script' }, { base_sha: 'main' },
    { expires_at: 1 }, { branch_name: 'main' }, { title: '' }, { description: 'x'.repeat(12001) },
    { repository: 'https://user:credential@example.invalid/repo.git' },
    { repository: 'file:///tmp/repo.git' }, { repository: 'https://example.invalid/repo.git?token=secret' },
  ]) assert.throws(() => validateJob(job(change)))
  assert.throws(() => validateJob(null))
})

test('uncommissioned runtimes are rejected for every provider', () => {
  for (const runtime of ['claude', 'codex', 'kimi', 'grok']) {
    assert.throws(() => validateJob(job({ runtime })), /Unsupported job runtime/)
  }
})

test('actual JSON job payload preserves supported Unicode and rejects oversized or malformed documents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mc-job-contract.'))
  const file = path.join(directory, 'mc-job.json')
  const payload = job({ description: '\u2713'.repeat(12_000) })
  await writeFile(file, JSON.stringify(payload))
  assert.deepEqual(await loadJob(file), payload)
  await writeFile(file, 'x'.repeat(65_537))
  await assert.rejects(loadJob(file), /size limit/)
  await writeFile(file, '{invalid input}')
  await assert.rejects(loadJob(file), /not valid JSON/)
})



test('job accepts the explicit end-to-end check', () => {
  assert.deepEqual(validateJob(job({ checks: ['test:e2e'] })).checks, ['test:e2e'])
})
