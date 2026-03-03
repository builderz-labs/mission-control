import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

/**
 * CLI Integration API
 *
 * Allows CLI-based AI agents (Codex CLI, Claude Code, Aider, etc.)
 * to register with Mission Control, report heartbeats/status,
 * and poll for assigned tasks.
 *
 * Authentication: x-api-key header (managed API token or env var)
 *
 * Endpoints:
 *   POST /api/cli                — Register a CLI agent
 *   GET  /api/cli?action=poll    — Poll for assigned tasks
 *   GET  /api/cli?action=status  — Get CLI agent's current status
 *   PUT  /api/cli                — Update status / report heartbeat
 */

function ensureCliTable(db: ReturnType<typeof getDatabase>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cli_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cli_type TEXT NOT NULL DEFAULT 'generic',
      machine_id TEXT,
      pid INTEGER,
      cwd TEXT,
      version TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_heartbeat_at INTEGER NOT NULL DEFAULT (unixepoch()),
      registered_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT
    )
  `)
  // Create index if not exists
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cli_agents_name ON cli_agents(name)`)
}

/**
 * POST /api/cli — Register a CLI agent
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    ensureCliTable(db)
    const body = await request.json()

    const { name, cli_type, machine_id, pid, cwd, version, metadata } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const validTypes = ['codex', 'claude-code', 'aider', 'continue', 'cursor', 'generic']
    const type = validTypes.includes(cli_type) ? cli_type : 'generic'

    // Upsert: if an agent with the same name + machine_id exists and is active, update it
    const existing = db.prepare(
      'SELECT id FROM cli_agents WHERE name = ? AND machine_id = ? AND status = ?'
    ).get(name, machine_id || null, 'active') as { id: number } | undefined

    if (existing) {
      db.prepare(`
        UPDATE cli_agents SET pid = ?, cwd = ?, version = ?, last_heartbeat_at = unixepoch(), metadata = ?
        WHERE id = ?
      `).run(pid || null, cwd || null, version || null, metadata ? JSON.stringify(metadata) : null, existing.id)

      return NextResponse.json({ id: existing.id, status: 'updated', message: 'CLI agent re-registered' })
    }

    const result = db.prepare(`
      INSERT INTO cli_agents (name, cli_type, machine_id, pid, cwd, version, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, type, machine_id || null, pid || null, cwd || null, version || null, metadata ? JSON.stringify(metadata) : null)

    const cliId = Number(result.lastInsertRowid)

    // Also register/update in the main agents table
    const existingAgent = db.prepare('SELECT id FROM agents WHERE name = ?').get(name) as { id: number } | undefined
    if (existingAgent) {
      db.prepare(`
        UPDATE agents SET status = 'idle', type = ?, last_seen = unixepoch(), updated_at = unixepoch()
        WHERE id = ?
      `).run(type, existingAgent.id)
    } else {
      db.prepare(`
        INSERT INTO agents (name, type, status, model, description, capabilities)
        VALUES (?, ?, 'idle', ?, ?, ?)
      `).run(
        name,
        type,
        version || 'cli',
        `CLI agent (${type}) registered from ${cwd || 'unknown'}`,
        JSON.stringify(['cli', 'code', type])
      )
    }

    eventBus.broadcast('agent.created', { name, type, source: 'cli' })

    logger.info({ name, type, cliId }, 'CLI agent registered')

    return NextResponse.json({
      id: cliId,
      status: 'registered',
      message: `CLI agent "${name}" registered successfully`,
      poll_url: '/api/cli?action=poll',
      heartbeat_url: '/api/cli',
    }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/cli error')
    return NextResponse.json({ error: 'Failed to register CLI agent' }, { status: 500 })
  }
}

/**
 * GET /api/cli — Poll for tasks or get status
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'status'
  const agentName = searchParams.get('name') || searchParams.get('agent')

  try {
    const db = getDatabase()
    ensureCliTable(db)

    if (action === 'poll' && agentName) {
      // Return tasks assigned to this agent that are in todo or in_progress
      const tasks = db.prepare(`
        SELECT id, title, description, status, priority, tags, created_at, updated_at
        FROM tasks
        WHERE assigned_to = ? AND status IN ('todo', 'in_progress')
        ORDER BY
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at ASC
        LIMIT 10
      `).all(agentName)

      return NextResponse.json({ tasks, agent: agentName })
    }

    if (action === 'status') {
      if (agentName) {
        const agent = db.prepare('SELECT * FROM cli_agents WHERE name = ? ORDER BY last_heartbeat_at DESC LIMIT 1').get(agentName)
        return NextResponse.json({ agent: agent || null })
      }

      // List all active CLI agents
      const agents = db.prepare(
        'SELECT * FROM cli_agents WHERE status = ? ORDER BY last_heartbeat_at DESC'
      ).all('active')

      return NextResponse.json({ agents, count: agents.length })
    }

    if (action === 'list') {
      const agents = db.prepare('SELECT * FROM cli_agents ORDER BY last_heartbeat_at DESC').all()
      return NextResponse.json({ agents, count: agents.length })
    }

    return NextResponse.json({ error: 'Invalid action. Use: poll, status, list' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/cli error')
    return NextResponse.json({ error: 'Failed to process CLI request' }, { status: 500 })
  }
}

/**
 * PUT /api/cli — Heartbeat / status update
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    ensureCliTable(db)
    const body = await request.json()

    const { id, name, status, task_id, task_status, output, metadata } = body

    if (!id && !name) {
      return NextResponse.json({ error: 'id or name is required' }, { status: 400 })
    }

    // Update CLI agent heartbeat
    if (id) {
      db.prepare(`
        UPDATE cli_agents SET last_heartbeat_at = unixepoch(), status = COALESCE(?, status), metadata = COALESCE(?, metadata)
        WHERE id = ?
      `).run(status || null, metadata ? JSON.stringify(metadata) : null, id)
    } else if (name) {
      db.prepare(`
        UPDATE cli_agents SET last_heartbeat_at = unixepoch(), status = COALESCE(?, status), metadata = COALESCE(?, metadata)
        WHERE name = ? AND status = 'active'
      `).run(status || null, metadata ? JSON.stringify(metadata) : null, name)
    }

    // Update the main agents table too
    const agentName = name || (id ? (db.prepare('SELECT name FROM cli_agents WHERE id = ?').get(id) as { name: string } | undefined)?.name : null)
    if (agentName) {
      const agentStatus = status === 'active' ? 'idle' : status === 'busy' ? 'busy' : status === 'done' ? 'idle' : status || 'idle'
      db.prepare('UPDATE agents SET status = ?, last_seen = unixepoch(), updated_at = unixepoch() WHERE name = ?')
        .run(agentStatus, agentName)
    }

    // If reporting task completion
    if (task_id && task_status) {
      const validStatuses = ['in_progress', 'done', 'blocked']
      if (validStatuses.includes(task_status)) {
        db.prepare('UPDATE tasks SET status = ?, updated_at = unixepoch() WHERE id = ?').run(task_status, task_id)

        if (output) {
          // Log the output as an activity
          db.prepare(`
            INSERT INTO activities (type, entity_type, entity_id, actor, description)
            VALUES ('task_update', 'task', ?, ?, ?)
          `).run(task_id, agentName || 'cli', `CLI output: ${String(output).slice(0, 500)}`)
        }

        eventBus.broadcast('task.updated', { id: task_id, status: task_status, source: 'cli' })
      }
    }

    return NextResponse.json({ ok: true, heartbeat: 'accepted' })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/cli error')
    return NextResponse.json({ error: 'Failed to update CLI agent' }, { status: 500 })
  }
}
