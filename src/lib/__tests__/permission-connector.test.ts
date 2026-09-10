import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  isBypassMode,
  parsePermissionMode,
  permissionArgv,
  permissionSupport,
  type UnifiedPermissionMode,
} from '../permission-connector'
import { nativePermissionMenu, permissionChip } from '../permission-menus'

const KINDS = ['claude-code', 'codex-cli', 'grok', 'kimi', 'opencode', 'gateway'] as const
const MODES: UnifiedPermissionMode[] = ['ask', 'auto', 'accept_edits', 'plan', 'bypass']

describe('permission connector', () => {
  it('parses desktop aliases into canonical modes', () => {
    expect(parsePermissionMode('bypassPermissions')).toBe('bypass')
    expect(parsePermissionMode('manual')).toBe('ask')
    expect(parsePermissionMode('acceptEdits')).toBe('accept_edits')
    expect(parsePermissionMode('default')).toBe('ask')
    expect(parsePermissionMode('yolo')).toBe('auto')
    expect(isBypassMode('bypass')).toBe(true)
    expect(isBypassMode('ask')).toBe(false)
  })

  it('maps every Claude desktop menu item to --permission-mode', () => {
    expect(permissionArgv('claude-code', 'auto')).toEqual(['--permission-mode', 'auto'])
    expect(permissionArgv('claude-code', 'ask')).toEqual(['--permission-mode', 'manual'])
    expect(permissionArgv('claude-code', 'accept_edits')).toEqual(['--permission-mode', 'acceptEdits'])
    expect(permissionArgv('claude-code', 'plan')).toEqual(['--permission-mode', 'plan'])
    expect(permissionArgv('claude-code', 'bypass')).toEqual(['--permission-mode', 'bypassPermissions'])
  })

  it('maps ChatGPT desktop options onto Codex flags', () => {
    expect(permissionArgv('codex-cli', 'ask')).toEqual([])
    expect(permissionArgv('codex-cli', 'auto')).toEqual(['--approve-for-me'])
    expect(permissionArgv('codex-cli', 'bypass')).toEqual(['--sandbox', 'danger-full-access'])
  })

  it('never emits dangerously-skip-permissions as a tool name', () => {
    for (const kind of KINDS) {
      for (const mode of MODES) {
        expect(permissionArgv(kind, mode).join(' ')).not.toContain('dangerously-skip-permissions')
      }
    }
  })

  it('Claude and ChatGPT menus match the desktop apps', () => {
    expect(nativePermissionMenu('claude-code').map((item) => item.title)).toEqual([
      'Auto', 'Manual', 'Accept edits', 'Plan', 'Bypass permissions',
    ])
    expect(nativePermissionMenu('codex-cli').map((item) => item.title)).toEqual([
      'Ask for approval', 'Approve for me', 'Full access',
    ])
    expect(permissionChip('codex-cli', 'bypass')).toEqual({
      text: 'Full access',
      accent: true,
      heading: 'How should ChatGPT actions be approved?',
    })
    expect(permissionChip('claude-code', 'bypass').text).toBe('Bypass permissions')
  })

  it('every runtime menu option is round-trippable to argv', () => {
    fc.assert(fc.property(fc.constantFrom(...KINDS), fc.constantFrom(...MODES), (kind, mode) => {
      const argv = permissionArgv(kind, mode)
      expect(Array.isArray(argv)).toBe(true)
      if (permissionSupport(kind) === 'none') expect(argv).toEqual([])
      const titles = nativePermissionMenu(kind)
      if (titles.length > 0 && titles.some((item) => item.id === mode)) {
        expect(permissionChip(kind, mode).text).toBe(titles.find((item) => item.id === mode)?.title)
      }
    }))
  })
})
