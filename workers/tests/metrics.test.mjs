import test from 'node:test'
import assert from 'node:assert/strict'
import { createResourceSampler } from '../metrics.mjs'

for (const version of ['v1', 'v2']) {
  test(`samples ${version} memory, swap and normalized CPU deltas`, async () => {
    let at = 1000; let usage = 1_000_000
    const read = async file => {
      const values = version === 'v2' ? {
        '/sys/fs/cgroup/cpu.stat': `usage_usec ${usage}\n`,
        '/sys/fs/cgroup/memory.current': '4096', '/sys/fs/cgroup/memory.swap.current': '1024',
      } : {
        '/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage': String(usage * 1000),
        '/sys/fs/cgroup/memory/memory.usage_in_bytes': '4096',
        '/sys/fs/cgroup/memory/memory.memsw.usage_in_bytes': '5120',
      }
      if (!(file in values)) throw Error('Unavailable')
      return values[file]
    }
    const sample = createResourceSampler({ read, now: () => at, cores: () => 2 })
    assert.deepEqual(await sample(), { memory_bytes: 4096, swap_bytes: 1024 })
    at += 1000; usage += 1_000_000
    assert.deepEqual(await sample(), { cpu_percent: 50, memory_bytes: 4096, swap_bytes: 1024 })
  })
}
test('missing resource sources remain unknown instead of zero', async () => {
  const sample = createResourceSampler({ read: async () => { throw Error('Unavailable') } })
  assert.deepEqual(await sample(), {})
  assert.deepEqual(await sample(), {})
})
test('malformed counters are ignored', async () => {
  const sample = createResourceSampler({ read: async () => 'invalid' })
  assert.deepEqual(await sample(), {})
})
