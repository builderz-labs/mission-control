import { describe, expect, it } from 'vitest'
import { conversationsToItems, gitLensByProject, withOptimisticUser } from '../chat-desktop-data'
import { ENGINE_LOGOS } from '../chat-session-identity'
import type { Conversation } from '@/store'

function conv(partial: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation {
  return {
    name: partial.name || partial.id,
    kind: 'claude-code',
    source: 'session',
    participants: [],
    unreadCount: 0,
    updatedAt: 100,
    lastMessage: {
      id: 1,
      conversation_id: partial.id,
      from_agent: 'system',
      to_agent: null,
      content: '',
      message_type: 'system',
      created_at: 100,
    },
    ...partial,
  }
}

describe('gitLensByProject', () => {
  it('nests four-engine sessions under the selected project', () => {
    const items = conversationsToItems([
      conv({
        id: 'session:claude-code:1',
        session: {
          prefKey: 'claude-code:1',
          sessionId: '1',
          sessionKind: 'claude-code',
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          lastUserPrompt: 'Cover the connector authorization gate',
          active: true,
        },
      }),
      conv({
        id: 'session:hermes:2',
        kind: 'hermes',
        session: {
          prefKey: 'hermes:2',
          sessionId: '2',
          sessionKind: 'hermes',
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          lastUserPrompt: 'skip me',
          active: true,
        },
      }),
    ], [])
    const map = gitLensByProject(items, {
      pinned: [],
      rest: [{ key: 'folder:stillpoint-builders', label: 'stillpoint-builders', sessionCount: 1, latestActivity: 100, hasPr: false, hasActive: true }],
    })
    expect(map['folder:stillpoint-builders']).toEqual([
      expect.objectContaining({
        id: 'session:claude-code:1',
        kind: 'claude-code',
        title: 'Cover the connector authorization gate',
      }),
    ])
  })

  it('sorts nested sessions by most recent activity', () => {
    const items = conversationsToItems([
      conv({
        id: 'session:claude-code:old',
        updatedAt: 10,
        session: {
          sessionId: 'old',
          sessionKind: 'claude-code',
          customTitle: 'Old chat',
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          lastActivity: 10,
        },
      }),
      conv({
        id: 'session:kimi:new',
        kind: 'kimi',
        updatedAt: 50,
        session: {
          sessionId: 'new',
          sessionKind: 'kimi',
          customTitle: 'New chat',
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          lastActivity: 50,
        },
      }),
    ], [])
    const map = gitLensByProject(items, {
      pinned: [],
      rest: [{
        key: 'folder:stillpoint-builders',
        label: 'stillpoint-builders',
        sessionCount: 2,
        latestActivity: 50,
        hasPr: false,
        hasActive: false,
      }],
    })
    expect(map['folder:stillpoint-builders'].map((row) => row.title)).toEqual(['New chat', 'Old chat'])
  })

  it('hides unnamed engine-id sessions unless they are live', () => {
    const items = conversationsToItems([
      conv({
        id: 'session:codex-cli:01a08c1f',
        kind: 'codex-cli',
        name: 'Codex · 01a08c1f',
        session: {
          sessionId: '01a08c1f',
          sessionKind: 'codex-cli',
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          active: false,
        },
      }),
      conv({
        id: 'session:claude-code:named',
        session: {
          sessionId: 'named',
          sessionKind: 'claude-code',
          customTitle: 'Worktree audit and consolidation',
          workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
          active: false,
        },
      }),
    ], [])
    expect(items.map((item) => item.name)).toEqual(['Worktree audit and consolidation'])
  })
})

describe('toHomeSessions', () => {
  it('sorts tree sessions newest first', async () => {
    const { toHomeSessions } = await import('../chat-desktop-data')
    const items = conversationsToItems([
      conv({ id: 'session:claude-code:old', updatedAt: 10, session: { sessionId: 'old', sessionKind: 'claude-code', customTitle: 'Old', workingDir: '/x/a' } }),
      conv({ id: 'session:kimi:new', kind: 'kimi', updatedAt: 50, session: { sessionId: 'new', sessionKind: 'kimi', customTitle: 'New', workingDir: '/x/a' } }),
    ], [])
    expect(toHomeSessions(items).map((row) => row.title)).toEqual(['New', 'Old'])
  })
})

describe('withOptimisticUser', () => {
  it('appends a pending user turn unless it is already the last user text', () => {
    const existing = [{ role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'hi' }] }]
    const withPending = withOptimisticUser(existing, 'Cover the gate')
    expect(withPending).toHaveLength(2)
    expect(withPending[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'Cover the gate' }] })
    const already = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'Cover the gate' }] }]
    expect(withOptimisticUser(already, 'Cover the gate')).toBe(already)
    expect(withOptimisticUser(existing, null)).toBe(existing)
  })
})

describe('engine logos', () => {
  it('uses png marks for the four tree engines', () => {
    expect(ENGINE_LOGOS['claude-code']).toBe('/brand/claude-logo.png')
    expect(ENGINE_LOGOS['codex-cli']).toBe('/brand/codex-logo.png')
    expect(ENGINE_LOGOS.grok).toBe('/brand/grok-logo.png')
    expect(ENGINE_LOGOS.kimi).toBe('/brand/kimi-logo.png')
  })
})
