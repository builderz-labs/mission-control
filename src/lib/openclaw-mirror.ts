import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { getAllGatewaySessions } from '@/lib/sessions'
import { deriveTasksFromSessions } from '@/lib/openclaw-task'
import { aliasSessionKey, applyAgentAlias, getNovaFrontDoorId } from '@/lib/identity-alias'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type SyncState = Record<string, { offset: number }>

const STATE_PATH = '/root/.openclaw/workspace/research/mission-control/.data/openclaw-comms-sync.json'

function loadState(): SyncState {
  try {
    if (!existsSync(STATE_PATH)) {
      mkdirSync(join(STATE_PATH, '..'), { recursive: true })
      return {}
    }
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveState(state: SyncState) {
  try {
    mkdirSync(join(STATE_PATH, '..'), { recursive: true })
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  } catch {
    // ignore
  }
}

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (!c) return ''
        if (typeof c === 'string') return c
        if (typeof (c as any).text === 'string') return (c as any).text
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const m = sessionKey.match(/^agent:([^:]+):/)
  return m ? m[1] : null
}

function parseTaskIdFromSessionKey(sessionKey: string): string | null {
  const m = sessionKey.match(/^agent:[^:]+:(proj:[^:]+:\d{8}:[a-z0-9-]+)$/i)
  return m ? m[1] : null
}

export function mirrorOpenClawTasksAndComms(): { tasksUpserted: number; commsInserted: number } {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // --- TASKS PROJECTION ---
  const sessions = getAllGatewaySessions()
  const lite = sessions.map((s) => ({ key: s.key, updatedAt: s.updatedAt, model: s.model }))
  const derived = deriveTasksFromSessions(lite)

  let tasksUpserted = 0

  for (const t of derived) {
    const title = t.taskId

    const tombstoned = db
      .prepare('SELECT 1 as ok FROM external_task_tombstones WHERE source = ? AND external_id = ? LIMIT 1')
      .get('openclaw', t.taskId) as any
    if (tombstoned?.ok) {
      continue
    }

    const existing = db.prepare('SELECT * FROM tasks WHERE title = ?').get(title) as any

    const metadata = {
      external: {
        source: 'openclaw',
        taskId: t.taskId,
        project: t.project,
        date: t.date,
        slug: t.slug,
      },
      openclaw: {
        sessions: t.sessions,
        lastUpdatedAt: t.lastUpdatedAt,
      },
    }

    const lastMs = t.lastUpdatedAt ?? 0
    const isActive = lastMs > 0 && Date.now() - lastMs < 2 * 60 * 1000
    const status = isActive ? 'in-progress' : 'review'

    if (!existing) {
      const description = `OpenClaw live task for project **${t.project}**\n\nSessions:\n${t.sessions
        .map((s) => `- ${s.key}${s.model ? ` (${s.model})` : ''}`)
        .join('\n')}`

      const stmt = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, assigned_to, created_by,
          created_at, updated_at, due_date, estimated_hours, tags, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const res = stmt.run(
        title,
        description,
        status,
        'medium',
        null,
        'system',
        now,
        now,
        null,
        null,
        JSON.stringify(['openclaw', t.project, 'auto']),
        JSON.stringify(metadata)
      )

      const taskId = res.lastInsertRowid as number
      db_helpers.logActivity('task_created', 'task', taskId, 'system', `Created OpenClaw task: ${title}`, {
        title,
        status,
      })

      const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any
      const parsed = { ...created, tags: JSON.parse(created.tags || '[]'), metadata: JSON.parse(created.metadata || '{}') }
      eventBus.broadcast('task.created', parsed)
      tasksUpserted += 1
    } else {
      db.prepare(`UPDATE tasks SET status = ?, updated_at = ?, metadata = ? WHERE id = ?`).run(
        status,
        now,
        JSON.stringify(metadata),
        existing.id
      )
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(existing.id) as any
      const parsed = { ...row, tags: JSON.parse(row.tags || '[]'), metadata: JSON.parse(row.metadata || '{}') }
      eventBus.broadcast('task.updated', parsed)
      tasksUpserted += 1
    }
  }

  // --- COMMS MIRRORING ---
  const state = loadState()
  let commsInserted = 0

  for (const sess of sessions) {
    const sessionKey = sess.key
    const runtimeAgentId = parseAgentIdFromSessionKey(sessionKey)
    if (!runtimeAgentId) continue

    const logicalAgentId = applyAgentAlias(runtimeAgentId)
    const taskId = parseTaskIdFromSessionKey(sessionKey)
    const sessionId = sess.sessionId
    if (!sessionId) continue

    const openclawHome = process.env.OPENCLAW_HOME || '/root/.openclaw'
    const jsonlPath = join(openclawHome, 'agents', runtimeAgentId, 'sessions', `${sessionId}.jsonl`)
    if (!existsSync(jsonlPath)) continue

    const raw = readFileSync(jsonlPath, 'utf-8')
    const lines = raw.split('\n')
    const storedOffset = state[sessionKey]?.offset ?? 0
    const offset = Math.min(storedOffset, lines.length)
    if (offset >= lines.length) {
      state[sessionKey] = { offset: lines.length }
      continue
    }

    const newLines = lines.slice(offset)
    for (const line of newLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: any
      try {
        obj = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (obj?.type !== 'message') continue

      const msg = obj?.message
      const role = msg?.role
      const content = msg?.content
      const text = extractText(content)
      if (!text) continue

      const conversation_id = taskId ? `coord:${taskId}` : `office:${aliasSessionKey(sessionKey)}`
      const requester = taskId ? 'conductor' : getNovaFrontDoorId()
      const from_agent = role === 'assistant' ? logicalAgentId : requester
      const to_agent = role === 'assistant' ? requester : logicalAgentId
      const created_at = Math.floor(new Date(obj.timestamp).getTime() / 1000) || Math.floor(Date.now() / 1000)

      const exists = db
        .prepare(
          'SELECT id FROM messages WHERE conversation_id = ? AND from_agent = ? AND to_agent = ? AND created_at = ? AND content = ? LIMIT 1'
        )
        .get(conversation_id, from_agent, to_agent, created_at, text) as any
      if (exists) continue

      const metadata = {
        source: 'openclaw',
        sessionKey,
        runtimeAgentId,
        logicalAgentId,
        role,
      }

      const stmt = db.prepare(
        'INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      const res = stmt.run(
        conversation_id,
        from_agent,
        to_agent,
        text,
        'text',
        JSON.stringify(metadata),
        created_at
      )

      commsInserted += 1

      const id = Number(res.lastInsertRowid)
      eventBus.broadcast('chat.message', {
        id,
        conversation_id,
        from_agent,
        to_agent,
        content: text,
        message_type: 'text',
        metadata,
        read_at: null,
        created_at,
      })
    }

    state[sessionKey] = { offset: lines.length }
  }

  saveState(state)

  return { tasksUpserted, commsInserted }
}
