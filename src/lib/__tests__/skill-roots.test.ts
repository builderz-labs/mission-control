import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'

// vi.hoisted ensures these are available in the vi.mock factory (which is hoisted)
const { mockReaddirSync, mockLstatSync } = vi.hoisted(() => ({
  mockReaddirSync: vi.fn(),
  mockLstatSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: { readdirSync: mockReaddirSync, lstatSync: mockLstatSync },
  readdirSync: mockReaddirSync,
  lstatSync: mockLstatSync,
}))

import { getSkillRoots } from '@/lib/skill-roots'

// Control openclawState via env var — avoids needing to mock homedir
const FAKE_OPENCLAW = '/fake-openclaw'

// Minimal Dirent-like helper
function dir(name: string) {
  return { name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }
}
function file(name: string) {
  return { name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('OPENCLAW_STATE_DIR', FAKE_OPENCLAW)
  mockReaddirSync.mockReturnValue([])
  mockLstatSync.mockReturnValue({ isSymbolicLink: () => false })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getSkillRoots — static roots', () => {
  it('returns 6 static roots by default', () => {
    expect(getSkillRoots()).toHaveLength(6)
  })

  it('includes expected source names in order', () => {
    const sources = getSkillRoots().map(r => r.source)
    expect(sources).toEqual([
      'user-agents', 'user-codex', 'project-agents', 'project-codex', 'openclaw', 'workspace',
    ])
  })

  it('openclaw root uses OPENCLAW_STATE_DIR', () => {
    const root = getSkillRoots().find(r => r.source === 'openclaw')
    expect(root?.path).toBe(join(FAKE_OPENCLAW, 'skills'))
  })

  it('workspace root uses OPENCLAW_STATE_DIR/workspace/skills', () => {
    const root = getSkillRoots().find(r => r.source === 'workspace')
    expect(root?.path).toBe(join(FAKE_OPENCLAW, 'workspace', 'skills'))
  })

  it('honours MC_SKILLS_USER_CODEX_DIR env var override', () => {
    vi.stubEnv('MC_SKILLS_USER_CODEX_DIR', '/custom/codex')
    const root = getSkillRoots().find(r => r.source === 'user-codex')
    expect(root?.path).toBe('/custom/codex')
  })

  it('honours MC_SKILLS_OPENCLAW_DIR env var override', () => {
    vi.stubEnv('MC_SKILLS_OPENCLAW_DIR', '/custom/openclaw-skills')
    const root = getSkillRoots().find(r => r.source === 'openclaw')
    expect(root?.path).toBe('/custom/openclaw-skills')
  })

  it('honours OPENCLAW_WORKSPACE_DIR for workspace root', () => {
    vi.stubEnv('OPENCLAW_WORKSPACE_DIR', '/custom/ws')
    const root = getSkillRoots().find(r => r.source === 'workspace')
    expect(root?.path).toBe(join('/custom/ws', 'skills'))
  })
})

describe('getSkillRoots — dynamic workspace-* discovery', () => {
  it('discovers valid workspace-* directories', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-hr'), dir('workspace-elyon')])
    const sources = getSkillRoots().map(r => r.source)
    expect(sources).toContain('workspace-hr')
    expect(sources).toContain('workspace-elyon')
  })

  it('sets correct default skill path for discovered agents', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-hr')])
    const root = getSkillRoots().find(r => r.source === 'workspace-hr')
    expect(root?.path).toBe(join(FAKE_OPENCLAW, 'workspace-hr', 'skills'))
  })

  it('honours MC_SKILLS_WORKSPACE_HR_DIR env var override', () => {
    vi.stubEnv('MC_SKILLS_WORKSPACE_HR_DIR', '/custom/hr-skills')
    mockReaddirSync.mockReturnValue([dir('workspace-hr')])
    const root = getSkillRoots().find(r => r.source === 'workspace-hr')
    expect(root?.path).toBe('/custom/hr-skills')
  })

  it('skips files (non-directories) in the scan', () => {
    mockReaddirSync.mockReturnValue([file('workspace-hr')])
    expect(getSkillRoots().map(r => r.source)).not.toContain('workspace-hr')
  })

  it('skips entries not prefixed with workspace-', () => {
    mockReaddirSync.mockReturnValue([dir('skills'), dir('sessions')])
    const sources = getSkillRoots().map(r => r.source)
    expect(sources.filter(s => s.startsWith('workspace-'))).toHaveLength(0)
  })

  it('rejects agent names with path traversal characters', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-../etc')])
    expect(getSkillRoots().map(r => r.source)).not.toContain('workspace-../etc')
  })

  it('rejects agent names with spaces or slashes', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-foo bar'), dir('workspace-foo/bar')])
    const sources = getSkillRoots().map(r => r.source)
    expect(sources.filter(s => s.startsWith('workspace-'))).toHaveLength(0)
  })

  it('accepts agent names with hyphens and underscores', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-my-agent_v2')])
    expect(getSkillRoots().map(r => r.source)).toContain('workspace-my-agent_v2')
  })

  it('rejects symlinked directories', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-evil')])
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true })
    expect(getSkillRoots().map(r => r.source)).not.toContain('workspace-evil')
  })

  it('skips entry when lstatSync throws', () => {
    mockReaddirSync.mockReturnValue([dir('workspace-broken')])
    mockLstatSync.mockImplementation(() => { throw new Error('EACCES') })
    expect(getSkillRoots().map(r => r.source)).not.toContain('workspace-broken')
  })

  it('logs a warning and returns only static roots when readdirSync throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT') })
    const roots = getSkillRoots()
    expect(roots).toHaveLength(6)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[skill-roots]'),
      expect.any(Error),
    )
  })
})
