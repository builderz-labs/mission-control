import { describe, expect, it } from 'vitest'
import {
  inferTreeKind,
  looksLikeSlugTitle,
  projectSlugOf,
  sessionTitle,
  sessionsForProject,
} from '../chat-session-identity'

describe('sessionTitle', () => {
  it('prefers the last user prompt', () => {
    expect(sessionTitle({
      lastUserPrompt: 'Cover the connector authorization gate',
      prefName: 'chat-desktop-parity',
      kind: 'claude-code',
      id: 'abc123456',
    })).toBe('Cover the connector authorization gate')
  })

  it('does not use slug-shaped titles', () => {
    expect(sessionTitle({
      lastUserPrompt: null,
      prefName: 'chat-desktop-parity • chat-desktop-parity',
      kind: 'claude-code',
      id: 'session:claude-code:deadbeef',
    })).toBe('Claude · deadbeef')
  })

  it('skips notification-shaped prompts', () => {
    expect(sessionTitle({
      lastUserPrompt: '<task-notification> <task-id>abc</task-id>',
      prefName: null,
      kind: 'claude-code',
      id: 'session:claude-code:deadbeefcafebabe',
    })).toBe('Claude · deadbeef')
  })

  it('uses Claude desktop customTitle over noise and engine-id prefs', () => {
    expect(sessionTitle({
      customTitle: 'Franchise readiness agent handoff',
      lastUserPrompt: '<task-notification>artifact-changed</task-notification>',
      prefName: 'Claude e4deed8c-857',
      kind: 'claude-code',
      id: 'e4deed8c-8578-4c6d-a421-175443c87942',
    })).toBe('Franchise readiness agent handoff')
  })

  it('skips interrupted-review XML titles', () => {
    expect(sessionTitle({
      customTitle: '<user_action> <context>User initiated a review task',
      lastUserPrompt: 'Cover the connector authorization gate',
      kind: 'claude-code',
      id: 'abc',
    })).toBe('Cover the connector authorization gate')
  })

  it('uses Grok/Kimi/Codex titles the same way', () => {
    expect(sessionTitle({ customTitle: 'Vault handoff', lastUserPrompt: 'Synced agents', kind: 'grok', id: 'g1' })).toBe('Vault handoff')
    expect(sessionTitle({ customTitle: 'fleet review', lastUserPrompt: 'review the fleet map', kind: 'kimi', id: 'k1' })).toBe('fleet review')
    expect(sessionTitle({ lastUserPrompt: 'Cover the connector authorization gate', kind: 'codex-cli', id: 'c1' })).toBe('Cover the connector authorization gate')
  })
})

describe('inferTreeKind', () => {
  it('maps kimi and grok from kind or model', () => {
    expect(inferTreeKind('kimi', undefined)).toBe('kimi')
    expect(inferTreeKind('hermes', 'xai/grok-4.6')).toBe('grok')
    expect(inferTreeKind('gateway', 'other')).toBeNull()
  })
})

describe('sessionsForProject', () => {
  it('keeps only four-engine sessions for the slug', () => {
    const rows = sessionsForProject([
      { projectSlug: 'stillpoint-builders', kind: 'claude-code' },
      { projectSlug: 'stillpoint-builders', kind: 'hermes' },
      { projectSlug: 'actz-may', kind: 'codex-cli' },
    ], 'folder:stillpoint-builders')
    expect(rows).toEqual([{ projectSlug: 'stillpoint-builders', kind: 'claude-code' }])
  })
})

describe('projectSlugOf', () => {
  it('uses the working-dir leaf', () => {
    expect(projectSlugOf('/Users/tylerdevries/Dev/stillpoint-builders')).toBe('stillpoint-builders')
  })
})

describe('looksLikeSlugTitle', () => {
  it('detects duplicated leaf titles', () => {
    expect(looksLikeSlugTitle('chat-desktop-parity • chat-desktop-parity')).toBe(true)
    expect(looksLikeSlugTitle('Cover the gate')).toBe(false)
  })
})
