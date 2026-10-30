import { describe, expect, it } from 'vitest'
import {
  canWriteZcodePermission,
  requestedZcodePermissionMode,
  resolveZcodePermissionMode,
} from '@/lib/zcode-permissions'

describe('ZCode permission configuration', () => {
  it('defaults to build and only resolves recognized agent-config modes', () => {
    expect(resolveZcodePermissionMode(null)).toBe('build')
    expect(resolveZcodePermissionMode('{"dispatchMode":"plan"}')).toBe('plan')
    expect(resolveZcodePermissionMode({ dispatchMode: 'EDIT' })).toBe('edit')
    expect(resolveZcodePermissionMode({ dispatchMode: 'rm-rf' })).toBe('build')
  })

  it('requires an admin to persist yolo in agent config', () => {
    expect(canWriteZcodePermission('operator', { dispatchMode: 'yolo' })).toBe(false)
    expect(canWriteZcodePermission('viewer', { dispatchMode: 'yolo' })).toBe(false)
    expect(canWriteZcodePermission('admin', { dispatchMode: 'yolo' })).toBe(true)
  })

  it('still lets operators configure the bounded modes', () => {
    for (const mode of ['plan', 'build', 'edit']) {
      expect(requestedZcodePermissionMode({ dispatchMode: mode })).toBe(mode)
      expect(canWriteZcodePermission('operator', { dispatchMode: mode })).toBe(true)
    }
  })
})
