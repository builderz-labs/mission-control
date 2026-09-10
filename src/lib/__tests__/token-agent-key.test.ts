import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { TOKEN_AGENT_KEY_SQL } from '@/lib/token-agent-key'

describe('TOKEN_AGENT_KEY_SQL', () => {
  it('groups heartbeat prefix rows and dispatch agent_name rows together', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE token_usage (
        session_id TEXT,
        agent_name TEXT,
        input_tokens INTEGER
      );
    `)
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('grok:cli', null, 10)
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('task-42', 'grok', 5)
    const rows = db.prepare(`
      SELECT ${TOKEN_AGENT_KEY_SQL} AS agent_key, SUM(input_tokens) AS total
      FROM token_usage
      GROUP BY agent_key
    `).all() as Array<{ agent_key: string; total: number }>
    expect(rows).toEqual([{ agent_key: 'grok', total: 15 }])
    db.close()
  })
})
