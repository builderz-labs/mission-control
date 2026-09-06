import test from 'node:test'
import assert from 'node:assert/strict'
import { RESULT_RETENTION_SECONDS, retainResult, workDeadline } from '../lifecycle.mjs'
import { job } from './helpers.mjs'

test('work plus result retention fits within the Machine expiry', () => {
  const startedAt = 1_000_000
  const leaf = job({ timeout_seconds: 1800, expires_at: 1150 })
  const deadline = workDeadline(leaf, startedAt)
  assert.equal(deadline, 1_030_000)
  assert.equal(deadline + RESULT_RETENTION_SECONDS * 1000, leaf.expires_at * 1000)
})

test('requested work timeout stays capped when the lease is longer', () => {
  assert.equal(workDeadline(job({ timeout_seconds: 20, expires_at: 2000 }), 1_000_000), 1_020_000)
})

test('expired or undersized leases fail before starting package work', () => {
  for (const expires_at of [900, 1000, 1100, 1120]) {
    assert.throws(() => workDeadline(job({ expires_at }), 1_000_000), /result retention/)
  }
})

test('terminal state remains collectable for exactly the configured retention', async () => {
  const calls = []
  await retainResult(async milliseconds => { calls.push(milliseconds) })
  assert.deepEqual(calls, [120_000])
})

test('terminal recovery uses remaining reserved lease without extending its budget', async () => {
  const calls = []
  const sleep = async milliseconds => { calls.push(milliseconds) }
  await retainResult(sleep, 1500, 1_000_000)
  await retainResult(sleep, 900, 1_000_000)
  await retainResult(sleep, 1e9, 1_000_000)
  assert.deepEqual(calls, [500_000, 0, 2_100_000])
})

