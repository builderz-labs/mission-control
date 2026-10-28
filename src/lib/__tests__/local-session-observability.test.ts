import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

const fixture = vi.hoisted(() => ({ home: '' }))
vi.mock('@/lib/config', () => ({ config: {
  get homeDir() { return fixture.home },
  get claudeHome() { return join(fixture.home, '.claude') },
} }))
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  const mocked = { ...actual, readFileSync: vi.fn(actual.readFileSync), createReadStream: vi.fn(actual.createReadStream) }; return { ...mocked, default: mocked }
})

let now: number
let file: string
const id = '11111111-1111-4111-8111-111111111111'
function entry(type: string, payload: unknown) {
  return JSON.stringify({ timestamp: new Date(now).toISOString(), type, payload }) + '\n'
}
function codexFile(extra = '') {
  writeFileSync(file, entry('session_meta', { id, cwd: '/projects/example' })
    + entry('event_msg', { type: 'user_message', message: 'Fix the broken search button' })
    + entry('event_msg', { type: 'task_started' }) + extra)
}

beforeEach(() => {
  vi.resetModules()
  fixture.home = mkdtempSync(join(tmpdir(), 'mc-local-sessions-'))
  mkdirSync(join(fixture.home, '.codex', 'sessions'), { recursive: true })
  mkdirSync(join(fixture.home, '.claude', 'projects', 'example'), { recursive: true })
  file = join(fixture.home, '.codex', 'sessions', `rollout-${id}.jsonl`)
  now = Date.now()
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(fixture.home, { recursive: true, force: true })
})

describe('local session summaries', () => {
  it('uses task lifecycle events instead of keeping completed turns active', async () => {
    codexFile(entry('event_msg', { type: 'task_complete' }))
    const { scanCodexSessions } = await import('@/lib/codex-sessions')
    expect(scanCodexSessions()[0]).toMatchObject({ isActive: false, turnState: 'idle',
      title: 'Fix the broken search button', lastUserPrompt: 'Fix the broken search button' })
    appendFileSync(file, entry('event_msg', { type: 'task_started' }))
    expect(scanCodexSessions()[0]).toMatchObject({ isActive: true, turnState: 'running' })
    appendFileSync(file, entry('event_msg', { type: 'turn_aborted' }))
    expect(scanCodexSessions()[0].isActive).toBe(false)
  })

  it('reuses unchanged summaries, invalidates appended files and expires cached activity', async () => {
    codexFile()
    const fs = await import('node:fs')
    const { scanCodexSessions } = await import('@/lib/codex-sessions')
    vi.mocked(fs.readFileSync).mockClear()
    expect(scanCodexSessions()[0].isActive).toBe(true)
    expect(scanCodexSessions()[0].isActive).toBe(true)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000)
    expect(scanCodexSessions()[0].isActive).toBe(false)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    appendFileSync(file, entry('event_msg', { type: 'task_complete' }))
    expect(scanCodexSessions()[0].turnState).toBe('idle')
    expect(fs.readFileSync).toHaveBeenCalledTimes(2)
    rmSync(file)
    expect(scanCodexSessions()).toEqual([])
  })

  it('reads user-assigned Codex names read-only and falls back without an index', async () => {
    codexFile()
    const db = new Database(join(fixture.home, '.codex', 'state_5.sqlite'))
    db.exec('CREATE TABLE threads (id TEXT, title TEXT, name TEXT, updated_at INTEGER)')
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run(id, 'Original prompt', 'Repair search', 1)
    db.close()
    const { scanCodexSessions } = await import('@/lib/codex-sessions')
    expect(scanCodexSessions()[0].title).toBe('Repair search')
    rmSync(join(fixture.home, '.codex', 'state_5.sqlite'))
    expect(scanCodexSessions()[0].title).toBe('Fix the broken search button')
  })

  it('caches Claude summaries without dropping historic sessions', async () => {
    const claudeFile = join(fixture.home, '.claude', 'projects', 'example', `${id}.jsonl`)
    const record = { sessionId: id, cwd: '/projects/example', timestamp: new Date(now).toISOString(),
      type: 'user', message: { role: 'user', content: 'Repair search' } }
    writeFileSync(claudeFile, JSON.stringify(record) + '\n')
    const fs = await import('node:fs')
    const { scanClaudeSessions } = await import('@/lib/claude-sessions')
    vi.mocked(fs.createReadStream).mockClear()
    expect(await scanClaudeSessions()).toHaveLength(1)
    expect(await scanClaudeSessions()).toHaveLength(1)
    expect(fs.createReadStream).toHaveBeenCalledTimes(1)
    appendFileSync(claudeFile, JSON.stringify({ ...record, message: { role: 'user', content: 'Add tests' } }) + '\n')
    expect((await scanClaudeSessions())[0].lastUserPrompt).toBe('Add tests')
    expect(fs.createReadStream).toHaveBeenCalledTimes(2)
    rmSync(claudeFile)
    expect(await scanClaudeSessions()).toEqual([])
  })

  it('shares in-flight Claude refreshes even when forced', async () => {
    const { syncClaudeSessions } = await import('@/lib/claude-sessions')
    const first = syncClaudeSessions(true)
    const second = syncClaudeSessions(true)
    expect(second).toBe(first)
    expect(await first).toMatchObject({ ok: true })
    expect(syncClaudeSessions(true)).not.toBe(first)
  })
})

describe('opening local transcripts', () => {
  it('reads only the requested Codex file and excludes system instructions', async () => {
    codexFile(entry('response_item', { type: 'message', role: 'developer', content: 'internal instructions' })
      + entry('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Repair search' }] })
      + entry('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed' }] }))
    writeFileSync(join(fixture.home, '.codex', 'sessions', 'unrelated.jsonl'), 'unrelated private content')
    const fs = await import('node:fs')
    const { __testables } = await import('@/lib/session-transcript-route')
    vi.mocked(fs.readFileSync).mockClear()
    const messages = __testables.readCodexTranscript(id, 40)
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1].parts).toEqual([{ type: 'text', text: 'Fixed' }])
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fs.readFileSync).mock.calls[0][0]).toBe(file)
  })

  it('opens legacy filenames by matching session metadata in a bounded header', async () => {
    writeFileSync(join(fixture.home, '.codex', 'sessions', 'legacy-name.jsonl'),
      entry('session_meta', { id }) + entry('response_item', { type: 'message', role: 'assistant', content: 'Legacy reply' }))
    const { __testables } = await import('@/lib/session-transcript-route')
    expect(__testables.readCodexTranscript(id, 40)[0].parts).toEqual([{ type: 'text', text: 'Legacy reply' }])
  })

  it('opens historic Claude files even after more than 300 newer sessions exist', async () => {
    const dir = join(fixture.home, '.claude', 'projects', 'example')
    writeFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ sessionId: id, type: 'user', message: { content: 'Old task' } }) + '\n')
    for (let i = 0; i < 301; i++) writeFileSync(join(dir, `newer-${i}.jsonl`), '{}\n')
    const { __testables } = await import('@/lib/session-transcript-route')
    expect(__testables.readClaudeTranscript(id, 40)[0].parts).toEqual([{ type: 'text', text: 'Old task' }])
  })
})
