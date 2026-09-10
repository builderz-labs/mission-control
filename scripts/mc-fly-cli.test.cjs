const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runFlyCli } = require('./mc-fly.cjs')
const response = value => ({ result: { content: [{ text: JSON.stringify(value) }] } })
test('status uses the existing MCP handler contract', async () => {
  assert.deepEqual(await runFlyCli(['status'], async msg => {
    assert.equal(msg.params.name, 'mc_fly_status'); return response({ ready: true })
  }), { ready: true })
})
test('submit and cancel preserve structured payload and ownership', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-fly-cli-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'payload.json'); fs.writeFileSync(file, JSON.stringify({ request_id: 'stable-id', submission_id: 'a'.repeat(32) }))
  for (const action of ['submit', 'cancel']) await runFlyCli([action, file], async msg => {
    assert.equal(msg.params.arguments.request_id, 'stable-id'); return response({ safe_local_fallback: false })
  })
  fs.writeFileSync(file, '[]'); await assert.rejects(runFlyCli(['submit', file]), /JSON object/)
  fs.writeFileSync(file, ' '.repeat(65537)); await assert.rejects(runFlyCli(['submit', file]), /64 KiB/)
})
test('invalid usage and error responses never imply local fallback', async () => {
  await assert.rejects(runFlyCli(['submit']), /Usage/)
  await assert.rejects(runFlyCli(['unknown']), /Usage/)
  await assert.rejects(runFlyCli(['status'], async () => ({ result: { isError: true, content: [{ text: 'Ownership unknown' }] } })), /Ownership unknown/)
  await assert.rejects(runFlyCli(['status'], async () => ({})), /invalid/)
})
