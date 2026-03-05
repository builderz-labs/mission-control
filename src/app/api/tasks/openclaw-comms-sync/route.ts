import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const bodySchema = z.object({
  sessionKeys: z.array(z.string()).max(200),
})

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

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const m = sessionKey.match(/^agent:([^:]+):/)
  return m ? m[1] : null
}

function parseTaskIdFromSessionKey(sessionKey: string): string | null {
  const m = sessionKey.match(/^agent:[^:]+:(proj:[^:]+:\d{8}:[a-z0-9-]+)$/i)
  return m ? m[1] : null
}

function resolveSessionId(openclawHome: string, agentId: string, sessionKey: string): string | null {
  try {
    const mapPath = join(openclawHome, 'agents', agentId, 'sessions', 'sessions.json')
    if (!existsSync(mapPath)) return null
    const data = JSON.parse(readFileSync(mapPath, 'utf-8'))
    const entry = data?.[sessionKey]
    if (entry?.sessionId) return String(entry.sessionId)
    return null
  } catch {
    return null
  }
}

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (!c) return ''
        if (typeof c === 'string') return c
        if (typeof c.text === 'string') return c.text
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const validated = await validateBody(request, bodySchema)
  if ('error' in validated) return validated.error

  const openclawHome = process.env.OPENCLAW_HOME || '/root/.openclaw'
  const db = getDatabase()
  const state = loadState()

  let inserted = 0

  for (const sessionKey of validated.data.sessionKeys) {
    const agentId = parseAgentIdFromSessionKey(sessionKey)
    const taskId = parseTaskIdFromSessionKey(sessionKey)
    if (!agentId || !taskId) continue

    const sessionId = resolveSessionId(openclawHome, agentId, sessionKey)
    if (!sessionId) continue

    const jsonlPath = join(openclawHome, 'agents', agentId, 'sessions', `${sessionId}.jsonl`)
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

      const conversation_id = `coord:${taskId}`
      const from_agent = role === 'assistant' ? agentId : (role || 'user')
      const to_agent = null
      const created_at = Math.floor(new Date(obj.timestamp).getTime() / 1000) || Math.floor(Date.now() / 1000)

      // Deduplicate by (conversation_id, from_agent, created_at, content hash)
      const exists = db
        .prepare('SELECT id FROM messages WHERE conversation_id = ? AND from_agent = ? AND created_at = ? AND content = ? LIMIT 1')
        .get(conversation_id, from_agent, created_at, text) as any
      if (exists) continue

      const stmt = db.prepare(
        'INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      const res = stmt.run(
        conversation_id,
        from_agent,
        to_agent,
        text,
        'text',
        JSON.stringify({ source: 'openclaw', sessionKey }),
        created_at
      )

      inserted += 1

      const id = Number(res.lastInsertRowid)
      eventBus.broadcast('chat.message', {
        id,
        conversation_id,
        from_agent,
        to_agent,
        content: text,
        message_type: 'text',
        metadata: { source: 'openclaw', sessionKey },
        read_at: null,
        created_at,
      })
    }

    state[sessionKey] = { offset: lines.length }
  }

  saveState(state)

  return NextResponse.json({ success: true, inserted })
}
