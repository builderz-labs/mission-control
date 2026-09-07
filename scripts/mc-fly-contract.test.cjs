const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateAdmission, validateStatus, validateCancellation, retryRead } = require('./mc-fly-contract.cjs')
const { createFlyTools } = require('./mc-fly-tools.cjs')

test('HTML, empty and inconsistent responses never authorize local fallback', () => {
  for (const value of [null, {}, { raw: '<html>login</html>' }]) {
    assert.throws(() => validateAdmission(value))
    assert.throws(() => validateStatus(value))
    assert.throws(() => validateCancellation(value))
  }
  assert.throws(() => validateAdmission({ route: 'fly', accepted: true, safe_local_fallback: true }))
  assert.throws(() => validateCancellation({ released: false, safe_local_fallback: true }))
  assert.equal(validateStatus({ ready: false, issues: ['disabled'], submissions: [], transport: 'polled' }).ready, false)
  assert.equal(validateAdmission({ route: 'local', accepted: false, safe_local_fallback: true }).accepted, false)
})
test('read retry is bounded and preserves failure', async () => {
  let calls = 0
  assert.equal(await retryRead(async () => { if (++calls === 1) throw Error('offline'); return 42 }, async () => {}), 42)
  calls = 0
  await assert.rejects(retryRead(async () => { calls++; throw Error('offline') }, async () => {}))
  assert.equal(calls, 2)
})
test('ambiguous submission retries reuse one idempotency key', async () => {
  const calls = []
  const submit = createFlyTools(async (method, route, body) => {
    calls.push({ method, route, body })
    if (calls.length === 1) throw Error('response lost')
    return { route: 'fly', accepted: true, safe_local_fallback: false, submission_id: 'a'.repeat(32), task_id: 1 }
  })[0]
  const result = await submit.handler({ title: 'Check', description: 'smoke', repository: 'https://github.com/example/repo.git', base_sha: 'a'.repeat(40) })
  assert.equal(result.accepted, true)
  assert.equal(calls[0].body.request_id, calls[1].body.request_id)
})
test('queued cancellation accepts only confirmed release', async () => {
  const cancel = createFlyTools(async () => ({ released: true, safe_local_fallback: true })).find(tool => tool.name === 'mc_cancel_fly_leaf')
  assert.equal((await cancel.handler({ submission_id: 'a'.repeat(32) })).released, true)
  await assert.rejects(cancel.handler({ submission_id: '../invalid' }))
})
test('all agent clients discover only commissioned command execution', () => {
  const submit = createFlyTools(async () => ({})).find(tool => tool.name === 'mc_submit_fly_leaf')
  assert.deepEqual(submit.inputSchema.properties.runtime.enum, ['command'])
})
test('status preserves server-reported global capacity separately from native slots', async () => {
  const capacity = { scope: 'controller-global', max_workers: 25, active_workers: 3, available_slots: 22, launch_batch_size: 3, native_subagent_limit: null }
  const status = createFlyTools(async () => ({ ready: true, issues: [], submissions: [], transport: 'polled', capacity })).find(tool => tool.name === 'mc_fly_status')
  assert.deepEqual((await status.handler({})).capacity, capacity)
})
