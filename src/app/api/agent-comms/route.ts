import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MessageRow = {
  id: number
  conversation_id: string
  from_agent: string
  to_agent: string | null
  content: string
  message_type: string
  metadata: string | null
  read_at: number | null
  created_at: number
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const since = searchParams.get('since')
    const agent = searchParams.get('agent')

    const humanNames = ['human', 'system', 'operator']
    const humanPlaceholders = humanNames.map(() => '?').join(',')

    let messagesQuery = `
      SELECT * FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
    `
    const messagesParams: Array<string | number> = [...humanNames, ...humanNames]

    if (since) {
      messagesQuery += ' AND created_at > ?'
      messagesParams.push(parseInt(since, 10))
    }
    if (agent) {
      messagesQuery += ' AND (from_agent = ? OR to_agent = ?)'
      messagesParams.push(agent, agent)
    }

    messagesQuery += ' ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?'
    messagesParams.push(limit, offset)

    const messages = db.prepare(messagesQuery).all(...messagesParams) as MessageRow[]

    let graphQuery = `
      SELECT
        from_agent, to_agent,
        COUNT(*) as message_count,
        MAX(created_at) as last_message_at
      FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
    `
    const graphParams: Array<string | number> = [...humanNames, ...humanNames]
    if (since) {
      graphQuery += ' AND created_at > ?'
      graphParams.push(parseInt(since, 10))
    }
    graphQuery += ' GROUP BY from_agent, to_agent ORDER BY message_count DESC'

    const edges = db.prepare(graphQuery).all(...graphParams)

    const statsQuery = `
      SELECT agent, SUM(sent) as sent, SUM(received) as received FROM (
        SELECT from_agent as agent, COUNT(*) as sent, 0 as received
        FROM messages WHERE to_agent IS NOT NULL
          AND from_agent NOT IN (${humanPlaceholders})
          AND to_agent NOT IN (${humanPlaceholders})
        GROUP BY from_agent
        UNION ALL
        SELECT to_agent as agent, 0 as sent, COUNT(*) as received
        FROM messages WHERE to_agent IS NOT NULL
          AND from_agent NOT IN (${humanPlaceholders})
          AND to_agent NOT IN (${humanPlaceholders})
        GROUP BY to_agent
      ) GROUP BY agent ORDER BY (sent + received) DESC
    `
    const statsParams = [...humanNames, ...humanNames, ...humanNames, ...humanNames]
    const agentStats = db.prepare(statsQuery).all(...statsParams)

    let countQuery = `
      SELECT COUNT(*) as total FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
    `
    const countParams: Array<string | number> = [...humanNames, ...humanNames]
    if (since) {
      countQuery += ' AND created_at > ?'
      countParams.push(parseInt(since, 10))
    }
    if (agent) {
      countQuery += ' AND (from_agent = ? OR to_agent = ?)'
      countParams.push(agent, agent)
    }
    const { total } = db.prepare(countQuery).get(...countParams) as { total: number }

    let seededCountQuery = `
      SELECT COUNT(*) as seeded FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
        AND conversation_id LIKE ?
    `
    const seededParams: Array<string | number> = [...humanNames, ...humanNames, 'conv-multi-%']
    if (since) {
      seededCountQuery += ' AND created_at > ?'
      seededParams.push(parseInt(since, 10))
    }
    if (agent) {
      seededCountQuery += ' AND (from_agent = ? OR to_agent = ?)'
      seededParams.push(agent, agent)
    }
    const { seeded } = db.prepare(seededCountQuery).get(...seededParams) as { seeded: number }

    const seededCount = seeded || 0
    const liveCount = Math.max(0, total - seededCount)
    const source =
      total === 0 ? 'empty' :
      liveCount === 0 ? 'seeded' :
      seededCount === 0 ? 'live' :
      'mixed'

    return NextResponse.json({
      messages: messages.map((msg) => ({
        ...msg,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
      })),
      total,
      graph: { edges, agentStats },
      source: { mode: source, seededCount, liveCount },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch agent communications' }, { status: 500 })
  }
}
