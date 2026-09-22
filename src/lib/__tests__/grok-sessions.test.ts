import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

describe('scanGrokSessions', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-grok-test-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('parses summary.json under encoded cwd dirs', async () => {
    const sessionDir = join(tempHome, '.grok', 'sessions', '%2FUsers%2Fdev', 'sess-1')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'summary.json'), JSON.stringify({
      info: { id: 'sess-1', cwd: '/Users/dev/omnia-vault' },
      session_summary: 'Vault handoff',
      created_at: '2026-09-01T10:00:00.000Z',
      last_active_at: new Date().toISOString(),
      num_messages: 12,
      num_chat_messages: 4,
      current_model_id: 'grok-4.6',
      last_turn_summary: 'Synced agents',
    }))

    const { scanGrokSessions } = await import('@/lib/grok-sessions')
    const sessions = scanGrokSessions(10)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'sess-1',
      projectPath: '/Users/dev/omnia-vault',
      projectSlug: 'omnia-vault',
      model: 'grok-4.6',
      userMessages: 4,
      lastUserPrompt: 'Synced agents',
      title: 'Vault handoff',
      isActive: true,
    })
  })

  it('skips unreadable trees and returns []', async () => {
    const { scanGrokSessions } = await import('@/lib/grok-sessions')
    expect(scanGrokSessions()).toEqual([])
  })
})
