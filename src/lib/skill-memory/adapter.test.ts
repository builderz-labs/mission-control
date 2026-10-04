import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { getSkillMemoryHealth, getSkillMemoryPolicy } from './adapter'

const native = { exists: vi.fn(), spawn: vi.fn() }
const probe = { exists: native.exists, exec: native.spawn as unknown as typeof spawnSync }

afterEach(() => {
  native.exists.mockReset()
  native.spawn.mockReset()
  delete process.env.AI_OPS_SKILLMEM_BIN
  delete process.env.AI_OPS_SKILLMEM_DB
})
it('reports missing skillmem without invoking an executable', () => {
  native.exists.mockReturnValue(false)
  expect(getSkillMemoryHealth(probe)).toMatchObject({ installed: false, chain_ok: null })
  expect(native.spawn).not.toHaveBeenCalled()
})
it('reports healthy local read-only inventory', () => {
  native.exists.mockReturnValue(true)
  native.spawn.mockImplementation((_exe: string, args: string[]) => {
    if (args[0] === '--version') return { status: 0, stdout: 'skillmem version 0.12.1', stderr: '' }
    if (args.at(-1) === 'doctor') return {
      status: 0, stdout: JSON.stringify({ schema_version: '12', total: 0, skills: 0, history_rows: 0 }), stderr: '',
    }
    return { status: 0, stdout: 'OK: chain intact', stderr: '' }
  })
  expect(getSkillMemoryHealth(probe)).toMatchObject({
    installed: true, version: '0.12.1', schema_version: '12', chain_ok: true,
  })
  expect(getSkillMemoryPolicy()).toMatchObject({ integration_mode: 'read_only', auto_trust: false })
  expect(native.spawn.mock.calls.every(([, args]) => !args.includes('trust'))).toBe(true)
})
