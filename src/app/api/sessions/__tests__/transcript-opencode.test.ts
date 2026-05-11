import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tempHome = ''
let dbRowsByName: Record<string, Array<{ id: number; data: string | null; time_created: number | null; time_updated: number | null }>> = {}
let partRowsByMessageId: Record<number, Array<{ data: string | null }>> = {}
let mockHasPart = false

vi.mock('@/lib/config', () => ({
  config: {
    get homeDir() {
      return tempHome
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'viewer' } })),
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn((dbPath?: string) => ({
    prepare: (query: string) => ({
      get: (...args: any[]) => {
        if (query.includes('sqlite_master') && args[0] === 'message') return { name: 'message' }
        if (query.includes('sqlite_master') && args[0] === 'part') return mockHasPart ? { name: 'part' } : undefined
        return undefined
      },
      all: (...args: any[]) => {
        const name = dbPath ? String(dbPath).split('/').pop() || '' : ''
        if (query.includes('FROM message')) return dbRowsByName[name] || []
        if (query.includes('FROM part')) return partRowsByMessageId[args[0]] || []
        return []
      },
    }),
    close: vi.fn(),
  })),
}))

describe('OpenCode transcript helper', () => {
  beforeEach(() => {
    vi.resetModules()
    tempHome = mkdtempSync(join(tmpdir(), 'mc-opencode-transcript-'))
    const base = join(tempHome, '.local', 'share', 'opencode')
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, 'opencode.db'), '')
    dbRowsByName = {
      'opencode.db': [
        {
          id: 1,
          data: JSON.stringify({ role: 'user', content: 'hello from opencode' }),
          time_created: Date.now() - 2000,
          time_updated: Date.now() - 2000,
        },
        {
          id: 2,
          data: JSON.stringify({ role: 'assistant', content: 'world from opencode', tokens: { total: 18 } }),
          time_created: Date.now() - 1000,
          time_updated: Date.now() - 1000,
        },
      ],
    }
    partRowsByMessageId = {}
    mockHasPart = false
  })

  afterEach(() => {
    if (tempHome) rmSync(tempHome, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('reads real OpenCode message rows instead of returning a synthetic summary', async () => {
    const { __testables } = await import('@/app/api/sessions/transcript/route')
    const messages = __testables.readOpenCodeTranscript('ses_e2e_1', 40)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'hello from opencode' })
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].parts.some((part: any) => part.type === 'text' && part.text.includes('world from opencode'))).toBe(true)
  })

  it('returns the newest transcript window for long OpenCode sessions', async () => {
    dbRowsByName['opencode.db'] = Array.from({ length: 220 }, (_, index) => ({
      id: index + 1,
      data: JSON.stringify({ role: 'assistant', content: `message-${index}` }),
      time_created: 1000 + index,
      time_updated: 1000 + index,
    }))

    const { __testables } = await import('@/app/api/sessions/transcript/route')
    const messages = __testables.readOpenCodeTranscript('ses_e2e_1', 40)
    expect(messages).toHaveLength(40)
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'message-180' })
    expect(messages[39].parts[0]).toMatchObject({ type: 'text', text: 'message-219' })
  })

  it('reads message content from the part table (OpenCode >= 1.4)', async () => {
    mockHasPart = true
    dbRowsByName['opencode.db'] = [
      {
        id: 10,
        data: JSON.stringify({ role: 'user' }),
        time_created: Date.now() - 2000,
        time_updated: Date.now() - 2000,
      },
      {
        id: 11,
        data: JSON.stringify({ role: 'assistant', tokens: { total: 42 } }),
        time_created: Date.now() - 1000,
        time_updated: Date.now() - 1000,
      },
    ]
    partRowsByMessageId = {
      10: [
        { data: JSON.stringify({ type: 'text', text: 'hello from part table' }) },
      ],
      11: [
        { data: JSON.stringify({ type: 'text', text: 'response from part table' }) },
        { data: JSON.stringify({ type: 'tool', tool: 'bash', callID: 'c1', state: {} }) },
      ],
    }

    const { __testables } = await import('@/app/api/sessions/transcript/route')
    const messages = __testables.readOpenCodeTranscript('ses_e2e_1', 40)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'hello from part table' })
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].parts.some((part: any) => part.type === 'text' && part.text.includes('response from part table'))).toBe(true)
    expect(messages[1].parts.some((part: any) => part.type === 'text' && part.text.includes('[Tool: bash]'))).toBe(true)
  })
})
