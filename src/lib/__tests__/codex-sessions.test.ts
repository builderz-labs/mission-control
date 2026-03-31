import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  closeSync: vi.fn(),
  openSync: vi.fn(),
  readFileSync: vi.fn(),
  readSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    ...fsMock,
    default: {
      ...actual,
      ...fsMock,
    },
  }
})

vi.mock('@/lib/config', () => ({
  config: { homeDir: '/mockhome' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}))

function dirStat() {
  return {
    isDirectory: () => true,
    isFile: () => false,
    mtimeMs: 0,
    size: 0,
  }
}

function fileStat(size: number, mtimeMs: number) {
  return {
    isDirectory: () => false,
    isFile: () => true,
    mtimeMs,
    size,
  }
}

describe('scanCodexSessions', () => {
  beforeEach(() => {
    vi.resetModules()
    fsMock.closeSync.mockReset()
    fsMock.openSync.mockReset()
    fsMock.readFileSync.mockReset()
    fsMock.readSync.mockReset()
    fsMock.readdirSync.mockReset()
    fsMock.statSync.mockReset()
  })

  afterEach(async () => {
    const mod = await import('../codex-sessions')
    mod.clearCodexSessionCache()
  })

  it('skips ancient oversized files instead of reading them', async () => {
    const now = Date.now()
    const root = '/mockhome/.codex/sessions'
    const recentFile = `${root}/2026/03/29/recent.jsonl`
    const ancientHugeFile = `${root}/2026/03/01/ancient-huge.jsonl`

    fsMock.readdirSync.mockImplementation((dir: string) => {
      switch (dir) {
        case root:
          return ['2026']
        case `${root}/2026`:
          return ['03']
        case `${root}/2026/03`:
          return ['29', '01']
        case `${root}/2026/03/29`:
          return ['recent.jsonl']
        case `${root}/2026/03/01`:
          return ['ancient-huge.jsonl']
        default:
          return []
      }
    })

    fsMock.statSync.mockImplementation((target: string) => {
      switch (target) {
        case root:
        case `${root}/2026`:
        case `${root}/2026/03`:
        case `${root}/2026/03/29`:
        case `${root}/2026/03/01`:
          return dirStat()
        case recentFile:
          return fileStat(1024, now)
        case ancientHugeFile:
          return fileStat(32 * 1024 * 1024, now - (20 * 24 * 60 * 60 * 1000))
        default:
          throw new Error(`unexpected stat target: ${target}`)
      }
    })

    fsMock.readFileSync.mockImplementation((target: string) => {
      if (target === recentFile) {
        return [
          '{"timestamp":"2026-03-29T00:00:00.000Z","type":"session_meta","payload":{"id":"recent-1","cwd":"/Users/j2w/.openclaw","model":"gpt-5"}}',
          '{"timestamp":"2026-03-29T00:05:00.000Z","type":"response_item","payload":{"type":"message","role":"assistant"}}',
        ].join('\n')
      }
      throw new Error(`should not read ${target}`)
    })

    const { scanCodexSessions } = await import('../codex-sessions')
    const sessions = scanCodexSessions(10)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('recent-1')
    expect(sessions[0]?.projectSlug).toBe('.openclaw')
  })

  it('samples active oversized files instead of full-reading them', async () => {
    const now = Date.now()
    const root = '/mockhome/.codex/sessions'
    const activeHugeFile = `${root}/2026/03/29/active-huge.jsonl`

    fsMock.readdirSync.mockImplementation((dir: string) => {
      switch (dir) {
        case root:
          return ['2026']
        case `${root}/2026`:
          return ['03']
        case `${root}/2026/03`:
          return ['29']
        case `${root}/2026/03/29`:
          return ['active-huge.jsonl']
        default:
          return []
      }
    })

    fsMock.statSync.mockImplementation((target: string) => {
      switch (target) {
        case root:
        case `${root}/2026`:
        case `${root}/2026/03`:
        case `${root}/2026/03/29`:
          return dirStat()
        case activeHugeFile:
          return fileStat(10 * 1024 * 1024, now)
        default:
          throw new Error(`unexpected stat target: ${target}`)
      }
    })

    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('large file should be sampled, not fully read')
    })

    fsMock.openSync.mockReturnValue(11)
    fsMock.readSync.mockImplementation((_fd: number, buffer: Buffer, _offset: number, length: number, position: number) => {
      const chunk = position === 0
        ? [
            '{"timestamp":"2026-03-29T00:00:00.000Z","type":"session_meta","payload":{"id":"active-1","cwd":"/Users/j2w/.openclaw","model":"gpt-5"}}',
            '',
          ].join('\n')
        : [
            'partial-prefix',
            '{"timestamp":"2026-03-29T00:30:00.000Z","type":"response_item","payload":{"type":"message","role":"assistant"}}',
            '{"timestamp":"2026-03-29T00:30:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":5,"output_tokens":20,"total_tokens":35}}}}',
            '',
          ].join('\n')
      const encoded = Buffer.from(chunk, 'utf-8')
      const bytes = Math.min(length, encoded.length)
      encoded.copy(buffer, 0, 0, bytes)
      return bytes
    })

    const { scanCodexSessions } = await import('../codex-sessions')
    const sessions = scanCodexSessions(10)

    expect(fsMock.openSync).toHaveBeenCalledWith(activeHugeFile, 'r')
    expect(fsMock.readFileSync).not.toHaveBeenCalled()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'active-1',
      projectSlug: '.openclaw',
      model: 'gpt-5',
      inputTokens: 15,
      outputTokens: 20,
      totalTokens: 35,
      isActive: true,
    })
  })
})
