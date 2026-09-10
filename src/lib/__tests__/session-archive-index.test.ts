import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('../config', () => ({
  config: { memoryDir: '' },
}))

vi.mock('../memory-search', () => ({
  indexFile: vi.fn(),
}))

import { config } from '../config'
import { archiveSessionMeta } from '../session-archive'
import { indexSessionArchives, listArchivedSessions } from '../session-archive-index'

describe('session archive index', () => {
  afterEach(() => {
    config.memoryDir = ''
  })

  it('lists archived rows after host file is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-archive-idx-'))
    config.memoryDir = dir
    const db = new Database(':memory:')
    archiveSessionMeta({
      kind: 'claude-code',
      sessionId: 'abc',
      workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
      lastUserPrompt: 'Cover the connector',
      lastActivity: 1_700_000_000_000,
    })
    indexSessionArchives(db, [{
      kind: 'claude-code',
      id: 'abc',
      workingDir: '/Users/tylerdevries/Dev/stillpoint-builders',
      lastUserPrompt: 'Cover the connector',
      lastActivity: 1_700_000_000_000,
    }])
    const rows = listArchivedSessions(db, 'stillpoint-builders')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'abc', kind: 'claude-code', flags: ['archived'] })
  })

  it('does not index missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-archive-idx-'))
    config.memoryDir = dir
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    writeFileSync(join(dir, 'sessions', 'note.md'), 'nope')
    const db = new Database(':memory:')
    expect(indexSessionArchives(db, [{ kind: 'grok', id: 'missing' }])).toBe(0)
    expect(listArchivedSessions(db)).toEqual([])
  })
})
