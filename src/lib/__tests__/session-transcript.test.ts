import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { __testables } from '@/app/api/sessions/transcript/route'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('session transcript route', () => {
  test('reads Hermes session transcripts from the local SQLite store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-hermes-transcript-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'state.db')
    const db = new Database(dbPath)

    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_call_id TEXT,
        tool_calls TEXT,
        tool_name TEXT,
        timestamp REAL NOT NULL,
        token_count INTEGER,
        finish_reason TEXT
      );
    `)

    db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('session-1', 'user', 'inspect local hermes session', null, null, null, 1773207726.8)

    db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-1',
      'assistant',
      null,
      null,
      JSON.stringify([{
        id: 'call-1',
        call_id: 'call-1',
        function: { name: 'memory', arguments: '{"action":"add"}' },
      }]),
      'memory',
      1773207727.1,
    )

    db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('session-1', 'tool', '{"success": true}', 'call-1', null, 'memory', 1773207727.2)

    db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('session-1', 'assistant', 'done', null, null, null, 1773207727.3)

    db.close()

    const messages = __testables.readHermesTranscriptFromDbPath(dbPath, 'session-1', 10)

    expect(messages).toHaveLength(4)
    expect(messages[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'inspect local hermes session' }],
    })
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'tool_use', id: 'call-1', name: 'memory', input: '{"action":"add"}' }],
    })
    expect(messages[2]).toMatchObject({
      role: 'system',
      parts: [{ type: 'tool_result', toolUseId: 'call-1', content: '{"success": true}', isError: false }],
    })
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }],
    })
  })
})
