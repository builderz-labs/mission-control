import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isZcodeSessionId, scanZcodeSessions } from '@/lib/zcode-sessions'

const SESSION_A = 'sess_11111111-1111-4111-8111-111111111111'
const SESSION_B = 'sess_22222222-2222-4222-8222-222222222222'

let dir: string

function writeSession(fileName: string, lines: string[]): void {
  writeFileSync(join(dir, fileName), `${lines.join('\n')}\n`, 'utf8')
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-zcode-rollout-'))
  process.env.ZCODE_ROLLOUT_DIR = dir

  writeSession(`${SESSION_A}.jsonl`, [
    JSON.stringify({ role: 'user', content: 'do the thing', timestamp: '2026-10-01T10:00:00.000Z' }),
    'not json at all',
    JSON.stringify({
      role: 'assistant',
      model: 'glm-5.3',
      usage: { input_tokens: 120, output_tokens: 30 },
      timestamp: '2026-10-01T10:00:20.000Z',
    }),
    JSON.stringify({ role: 'assistant', usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } }),
  ])

  writeSession(`${SESSION_B}.jsonl`, [
    JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'fresh' },
      timestamp: new Date().toISOString(),
    }),
  ])

  // Rollouts that are not session transcripts stay out of the inventory.
  writeSession('model-io-debug.jsonl', [JSON.stringify({ role: 'user', content: 'ignored' })])
})

afterAll(() => {
  delete process.env.ZCODE_ROLLOUT_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('scanZcodeSessions', () => {
  it('reads one row per session rollout and skips unrelated files', () => {
    const sessions = scanZcodeSessions(50)
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([SESSION_A, SESSION_B].sort())
  })

  it('sums message counts and token usage across tolerant line parsing', () => {
    const session = scanZcodeSessions(50).find((s) => s.sessionId === SESSION_A)
    expect(session).toBeDefined()
    expect(session?.userMessages).toBe(1)
    expect(session?.assistantMessages).toBe(2)
    expect(session?.inputTokens).toBe(125)
    expect(session?.outputTokens).toBe(35)
    expect(session?.model).toBe('glm-5.3')
    expect(session?.lastMessageAt).toBe('2026-10-01T10:00:20.000Z')
    expect(session?.isActive).toBe(false)
  })

  it('marks a session active when its newest entry is inside the activity window', () => {
    const session = scanZcodeSessions(50).find((s) => s.sessionId === SESSION_B)
    expect(session?.isActive).toBe(true)
  })

  it('returns nothing when the rollout directory does not exist', () => {
    process.env.ZCODE_ROLLOUT_DIR = join(dir, 'missing')
    expect(scanZcodeSessions(50)).toEqual([])
    process.env.ZCODE_ROLLOUT_DIR = dir
  })
})

describe('isZcodeSessionId', () => {
  it('accepts only ZCode-shaped session ids', () => {
    expect(isZcodeSessionId(SESSION_A)).toBe(true)
    expect(isZcodeSessionId('11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(isZcodeSessionId('sess_../etc/passwd')).toBe(false)
    expect(isZcodeSessionId(null)).toBe(false)
  })
})
