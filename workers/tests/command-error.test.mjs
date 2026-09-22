import test from 'node:test'
import assert from 'node:assert/strict'
import { packageFailure } from '../command-error.mjs'

test('dependency failure includes useful bounded diagnostics', () => {
  const error = packageFailure('Dependency setup', 1, 'progress\ngyp ERR! find Python Python is not set', {})
  assert.match(error.message, /find Python/)
  assert.ok(packageFailure('Dependency setup', 1, 'error: ' + 'x'.repeat(10000), {}).message.length < 450)
})
test('package diagnostics redact credentials and URLs', () => {
  const error = packageFailure('Browser setup', 1, 'error: private-value-123 Bearer hidden https://secret@example.com/path token=abcdefghi', { API_KEY: 'private-value-123' })
  for (const secret of ['private-value-123', 'hidden', 'secret@example', 'abcdefghi']) assert.ok(!error.message.includes(secret))
})
test('LLM and other command output remains excluded from errors', () => {
  assert.equal(packageFailure('Claude worker', 1, 'error: private transcript', {}).message, 'Claude worker failed (exit 1)')
})
