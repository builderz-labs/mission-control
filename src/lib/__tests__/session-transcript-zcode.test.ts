import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __testables } from '@/lib/session-transcript-route'
import { createZcodeSessionDb } from './fixtures/zcode-session-db'

const { readZcodeTranscript } = __testables

const MISSING = 'sess_44444444-4444-4444-8444-444444444444'
const SHAPED = 'sess_55555555-5555-5555-8555-555555555555'
const OPAQUE = 'sess_66666666-6666-6666-8666-666666666666'
const DB_ONLY = 'sess_77777777-7777-4777-8777-777777777777'
const IN_BOTH = 'sess_88888888-8888-4888-8888-888888888888'

const T0 = Date.parse('2026-10-03T10:00:00.000Z')

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-zcode-transcript-'))
  process.env.ZCODE_ROLLOUT_DIR = dir
  process.env.ZCODE_DB_PATH = join(dir, 'db.sqlite')

  const db = new Database(process.env.ZCODE_DB_PATH)
  createZcodeSessionDb(db, [
    {
      id: DB_ONLY,
      updatedMs: T0,
      messages: [
        { role: 'user', text: 'fix the flaky test', createdMs: T0 },
        {
          role: 'assistant',
          text: '',
          createdMs: T0 + 1000,
          parts: [
            { type: 'reasoning', text: 'check the order' },
            { type: 'tool', callID: 'call_1', tool: 'Bash', state: { status: 'completed', input: { command: 'pnpm test' } } },
            { type: 'text', text: 'green' },
          ],
        },
      ],
    },
    { id: IN_BOTH, updatedMs: T0, messages: [{ role: 'user', text: 'from the database', createdMs: T0 }] },
  ])
  db.close()

  // Rollout captures cover only some sessions and hold raw model traffic; they remain
  // a fallback for history the database no longer has.
  writeFileSync(join(dir, `model-io-${SHAPED}.jsonl`), [
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'plan the adapter' }, timestamp: '2026-10-02T10:00:00.000Z' }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } }),
  ].join('\n'), 'utf8')

  writeFileSync(join(dir, `model-io-${OPAQUE}.jsonl`), [
    JSON.stringify({ kind: 'internal', payload: { opaque: true } }),
    'garbage',
  ].join('\n'), 'utf8')

  writeFileSync(join(dir, `model-io-${IN_BOTH}.jsonl`), [
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'from the rollout' }, timestamp: '2026-10-02T10:00:00.000Z' }),
  ].join('\n'), 'utf8')
})

afterAll(() => {
  delete process.env.ZCODE_ROLLOUT_DIR
  delete process.env.ZCODE_DB_PATH
  rmSync(dir, { recursive: true, force: true })
})

describe('readZcodeTranscript', () => {
  it('reads roles from message rows and content from part rows', () => {
    const messages = readZcodeTranscript(DB_ONLY, 40)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].parts).toEqual([{ type: 'text', text: 'fix the flaky test' }])
    expect(messages[0].timestamp).toBe(new Date(T0).toISOString())
    expect(messages[1].parts).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'Bash', input: '{"command":"pnpm test"}' },
      { type: 'text', text: 'green' },
    ])
  })

  it('prefers the session database over a rollout capture of the same session', () => {
    const messages = readZcodeTranscript(IN_BOTH, 40)
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'from the database' })
  })

  it('falls back to the rollout capture, and returns nothing for unrecognized records', () => {
    expect(readZcodeTranscript(SHAPED, 40).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(readZcodeTranscript(OPAQUE, 40)).toEqual([])
  })

  it('returns nothing for an unknown session or an unsafe session id', () => {
    expect(readZcodeTranscript(MISSING, 40)).toEqual([])
    expect(readZcodeTranscript('../../etc/passwd', 40)).toEqual([])
  })

  it('refuses an id that is not a session id even when a capture file matches it', () => {
    writeFileSync(join(dir, 'model-io-not-a-session-id.jsonl'), JSON.stringify({
      type: 'message', message: { role: 'user', content: 'must stay unread' },
    }), 'utf8')
    expect(readZcodeTranscript('not-a-session-id', 40)).toEqual([])
  })
})
