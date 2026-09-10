import { describe, expect, it } from 'vitest'
import { mapProviderSessions, readSessionPrefs, readSessions } from '../chat-session-map'

describe('readSessions', () => {
  it('drops records without ids', () => {
    expect(readSessions({ sessions: [{ id: 'abc' }, { name: 'nope' }] })).toEqual([
      expect.objectContaining({ id: 'abc' }),
    ])
  })

  it('returns empty for malformed payloads', () => {
    expect(readSessions(null)).toEqual([])
    expect(readSessions({})).toEqual([])
  })
})

describe('readSessionPrefs', () => {
  it('reads name and color', () => {
    expect(readSessionPrefs({ prefs: { 'claude-code:1': { name: 'Gate', color: 'blue' } } })).toEqual({
      'claude-code:1': { name: 'Gate', color: 'blue' },
    })
  })
})

describe('mapProviderSessions', () => {
  it('builds a session conversation sorted by activity', () => {
    const mapped = mapProviderSessions(
      [
        {
          id: 'old',
          kind: 'claude-code',
          lastActivity: 100,
          workingDir: '/Users/tylerdevries/Dev/actz-may',
        },
        {
          id: 'new',
          kind: 'codex-cli',
          lastActivity: 200,
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          agent: 'codex',
        },
      ],
      {},
    )
    expect(mapped[0].id).toBe('session:codex-cli:new')
    expect(mapped[0].session?.sessionKind).toBe('codex-cli')
    expect(mapped[1].name).toBe('Claude · old')
    expect(mapped[1].session?.workingDir).toContain('actz-may')
  })
})
