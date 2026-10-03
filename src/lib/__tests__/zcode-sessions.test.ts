import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getZcodeDbPath, isZcodeSessionId, scanZcodeSessions } from '@/lib/zcode-sessions'
import { createZcodeSessionDb, type FixtureSession } from './fixtures/zcode-session-db'

const ACTIVE = 'sess_11111111-1111-4111-8111-111111111111'
const CHILD = 'sess_22222222-2222-4222-8222-222222222222'
const SIDE = 'sess_99999999-9999-4999-8999-999999999999'
const ARCHIVED = 'sess_33333333-3333-4333-8333-333333333333'
const RECENT = 'sess_44444444-4444-4444-8444-444444444444'
const STALE = 'sess_55555555-5555-4555-8555-555555555555'
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

let dir: string
let dbPath: string

function fixture(now: number): FixtureSession[] {
  return [
    {
      id: ACTIVE,
      updatedMs: now - 60_000,
      directory: 'E:\\work\\api',
      usage: { input: 120, output: 30, lastMs: now - 45_000 },
      models: ['glm-5.2', 'glm-5.3'],
      messages: [
        { role: 'user', text: 'do the thing', createdMs: now - 60_000 },
        { role: 'user', text: 'and again', createdMs: now - 50_000 },
        { role: 'assistant', text: 'done', createdMs: now - 45_000 },
      ],
    },
    // Neither a spawned child run nor a side-agent row is a resumable entry point, and
    // the two are excluded by different columns, so both stay in the fixture.
    { id: CHILD, updatedMs: now - 30_000, parentId: ACTIVE },
    { id: SIDE, updatedMs: now - 25_000, taskType: 'subagent_child' },
    { id: ARCHIVED, updatedMs: now - 20_000, archivedMs: now },
    { id: RECENT, updatedMs: now - 30 * 1000 },
    { id: STALE, updatedMs: now - THREE_DAYS_MS, usage: { lastMs: now - THREE_DAYS_MS } },
  ]
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-zcode-db-'))
  dbPath = join(dir, 'db.sqlite')
  const db = new Database(dbPath)
  createZcodeSessionDb(db, fixture(Date.now()))
  db.close()
  process.env.ZCODE_DB_PATH = dbPath
})

afterAll(() => {
  delete process.env.ZCODE_DB_PATH
  rmSync(dir, { recursive: true, force: true })
})

describe('scanZcodeSessions', () => {
  it('lists top-level sessions newest first, without children or archived runs', () => {
    expect(scanZcodeSessions(50).map((s) => s.sessionId)).toEqual([RECENT, ACTIVE, STALE])
  })

  it('maps working dir, latest model, message counts and token sums from the database', () => {
    const session = scanZcodeSessions(50).find((s) => s.sessionId === ACTIVE)
    expect(session?.workingDir).toBe('E:\\work\\api')
    expect(session?.model).toBe('glm-5.3')
    expect(session?.userMessages).toBe(2)
    expect(session?.assistantMessages).toBe(1)
    expect(session?.inputTokens).toBe(120)
    expect(session?.outputTokens).toBe(30)
    expect(session?.totalTokens).toBe(150)
  })

  it('takes the newest request completion as the activity timestamp', () => {
    const session = scanZcodeSessions(50).find((s) => s.sessionId === ACTIVE)
    const lastMs = session?.lastMessageAt ? Date.parse(session.lastMessageAt) : 0
    expect(Math.abs(lastMs - (Date.now() - 45_000))).toBeLessThan(5_000)
  })

  it('marks only sessions inside the activity window active', () => {
    const byId = new Map(scanZcodeSessions(50).map((s) => [s.sessionId, s.isActive]))
    expect(byId.get(ACTIVE)).toBe(true)
    expect(byId.get(STALE)).toBe(false)
  })

  it('resolves the database under the ZCode state dir and honors the override', () => {
    delete process.env.ZCODE_DB_PATH
    expect(getZcodeDbPath('/home/operator')).toBe(join('/home/operator', '.zcode', 'cli', 'db', 'db.sqlite'))
    process.env.ZCODE_DB_PATH = dbPath
    expect(getZcodeDbPath('/home/operator')).toBe(dbPath)
  })

  it('yields no sessions when the database is absent or has no session table', () => {
    const override = process.env.ZCODE_DB_PATH
    delete process.env.ZCODE_DB_PATH
    expect(scanZcodeSessions(50, join(dir, 'no-such-home'))).toEqual([])
    process.env.ZCODE_DB_PATH = override
    const foreign = join(dir, 'foreign.sqlite')
    new Database(foreign).exec('CREATE TABLE unrelated (id TEXT);').close()
    process.env.ZCODE_DB_PATH = foreign
    expect(scanZcodeSessions(50)).toEqual([])
    process.env.ZCODE_DB_PATH = dbPath
  })
})

describe('isZcodeSessionId', () => {
  it('accepts only ZCode-shaped session ids', () => {
    expect(isZcodeSessionId(ACTIVE)).toBe(true)
    expect(isZcodeSessionId('11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(isZcodeSessionId('sess_../etc/passwd')).toBe(false)
    expect(isZcodeSessionId(null)).toBe(false)
  })
})
