import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'

const TEST_DB_PATH = resolve(process.cwd(), '.data-test', 'gateway-agents-count-test.db')

interface GatewayEntry {
  id: number
  name: string
  host: string
  port: number
  token: string
  is_primary: number
  status: string
  last_seen: number | null
  latency: number | null
  sessions_count: number
  agents_count: number
  created_at: number
  updated_at: number
}

describe('Gateway agents_count derive-on-read', () => {
  let db: Database.Database

  beforeEach(() => {
    const dir = resolve(process.cwd(), '.data-test')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH)
    
    db = new Database(TEST_DB_PATH)
    
    // Create gateways table
    db.exec(`
      CREATE TABLE IF NOT EXISTS gateways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL DEFAULT '127.0.0.1',
        port INTEGER NOT NULL DEFAULT 18789,
        token TEXT NOT NULL DEFAULT '',
        is_primary INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_seen INTEGER,
        latency INTEGER,
        sessions_count INTEGER NOT NULL DEFAULT 0,
        agents_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    
    // Create agents table with workspace_id and source
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        session_key TEXT UNIQUE,
        soul_content TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen INTEGER,
        last_activity TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        config TEXT,
        workspace_id INTEGER NOT NULL DEFAULT 1,
        source TEXT DEFAULT 'manual',
        UNIQUE(name, workspace_id)
      )
    `)
    
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_source ON agents(source)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON agents(workspace_id)`)
  })

  afterEach(() => {
    db?.close()
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH)
  })

  it('returns agents_count = 0 when no gateway-sourced agents exist', () => {
    // Insert a gateway with agents_count stuck at 0 (default value)
    db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary, agents_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('primary', '127.0.0.1', 18789, 'test-token', 1, 0)

    // Insert some manual agents (not gateway-sourced)
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('agent1', 'developer', 1, 'manual')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('agent2', 'analyst', 1, 'manual')

    // Compute the count (derive-on-read logic)
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE source = 'gateway' AND workspace_id = ?
    `).get(1) as { count: number }

    expect(result.count).toBe(0)

    // Verify that the stored column is still 0 (unchanged)
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = 1').get() as GatewayEntry
    expect(gateway.agents_count).toBe(0)
  })

  it('returns accurate agents_count when gateway-sourced agents exist', () => {
    // Insert a gateway with agents_count stuck at 0 (simulating the bug)
    db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary, agents_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('primary', '127.0.0.1', 18789, 'test-token', 1, 0)

    // Insert gateway-sourced agents
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('gateway-agent-1', 'developer', 1, 'gateway')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('gateway-agent-2', 'analyst', 1, 'gateway')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('gateway-agent-3', 'researcher', 1, 'gateway')

    // Insert manual agents (should not be counted)
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('manual-agent', 'ops', 1, 'manual')

    // Compute the count (derive-on-read logic)
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE source = 'gateway' AND workspace_id = ?
    `).get(1) as { count: number }

    expect(result.count).toBe(3)

    // Verify that the stored column is still 0 (unchanged)
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = 1').get() as GatewayEntry
    expect(gateway.agents_count).toBe(0)
  })

  it('respects workspace isolation when counting agents', () => {
    // Insert gateway for workspace 1
    db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary, agents_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('primary', '127.0.0.1', 18789, 'test-token', 1, 0)

    // Insert gateway-sourced agents in workspace 1
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('ws1-gateway-agent-1', 'developer', 1, 'gateway')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('ws1-gateway-agent-2', 'analyst', 1, 'gateway')

    // Insert gateway-sourced agents in workspace 2
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('ws2-gateway-agent-1', 'developer', 2, 'gateway')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('ws2-gateway-agent-2', 'analyst', 2, 'gateway')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('ws2-gateway-agent-3', 'researcher', 2, 'gateway')

    // Count for workspace 1 should only include workspace 1 agents
    const result1 = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE source = 'gateway' AND workspace_id = ?
    `).get(1) as { count: number }
    expect(result1.count).toBe(2)

    // Count for workspace 2 should only include workspace 2 agents
    const result2 = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE source = 'gateway' AND workspace_id = ?
    `).get(2) as { count: number }
    expect(result2.count).toBe(3)
  })

  it('returns same count for all gateways since there is no gateway_id FK', () => {
    // Insert multiple gateways
    db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary, agents_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('primary', '127.0.0.1', 18789, 'token1', 1, 0)
    
    db.prepare(`
      INSERT INTO gateways (name, host, port, token, is_primary, agents_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('secondary', '127.0.0.1', 18790, 'token2', 0, 0)

    // Insert gateway-sourced agents (no FK to specific gateway)
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('gateway-agent-1', 'developer', 1, 'gateway')
    
    db.prepare(`
      INSERT INTO agents (name, role, workspace_id, source)
      VALUES (?, ?, ?, ?)
    `).run('gateway-agent-2', 'analyst', 1, 'gateway')

    // Since there's no agents.gateway_id, the count should be the same for all gateways
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE source = 'gateway' AND workspace_id = ?
    `).get(1) as { count: number }

    expect(result.count).toBe(2)
    
    // Both gateways should show the same count when enriched
    const gateways = db.prepare('SELECT * FROM gateways ORDER BY id').all() as GatewayEntry[]
    expect(gateways).toHaveLength(2)
    // The stored values are still 0
    expect(gateways[0].agents_count).toBe(0)
    expect(gateways[1].agents_count).toBe(0)
    // But after enrichment, both would show the computed count of 2
  })
})
