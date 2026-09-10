import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { evaluateAllRules } from '@/lib/alert-evaluate'

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY,
      name TEXT,
      status TEXT,
      last_seen INTEGER,
      workspace_id INTEGER
    );
    CREATE TABLE alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      entity_type TEXT,
      condition_field TEXT,
      condition_operator TEXT,
      condition_value TEXT,
      action_type TEXT,
      action_config TEXT,
      cooldown_minutes INTEGER DEFAULT 60,
      last_triggered_at INTEGER,
      trigger_count INTEGER DEFAULT 0,
      created_by TEXT,
      workspace_id INTEGER
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT,
      type TEXT,
      title TEXT,
      message TEXT,
      source_type TEXT,
      source_id INTEGER,
      workspace_id INTEGER
    );
  `)
  return db
}

describe('evaluateAllRules', () => {
  it('seeds five fleet offline rules and fires for an offline agent', () => {
    const db = setup()
    db.prepare("INSERT INTO agents (name, status, last_seen, workspace_id) VALUES ('grok', 'offline', 1, 1)").run()
    const result = evaluateAllRules(db, 1)
    expect(result.seeded).toBe(5)
    expect(result.evaluated).toBe(5)
    const grok = result.results.find((row) => row.rule_name === 'grok-offline')
    expect(grok?.triggered).toBe(true)
    db.close()
  })

  it('treats non-numeric count_above values as a match, not parseInt NaN', () => {
    const db = setup()
    db.prepare("INSERT INTO agents (name, status, last_seen, workspace_id) VALUES ('codex', 'offline', 1, 1)").run()
    db.prepare(`
      INSERT INTO alert_rules (name, enabled, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes, created_by, workspace_id)
      VALUES ('offline-count', 1, 'agent', 'status', 'count_above', 'offline', 'notification', '{}', 60, 'system', 1)
    `).run()
    const result = evaluateAllRules(db, 1)
    const rule = result.results.find((row) => row.rule_name === 'offline-count')
    expect(rule?.triggered).toBe(true)
    db.close()
  })
})
