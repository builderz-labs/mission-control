import { NextRequest, NextResponse } from "next/server"
import { getDatabase, Message } from "@/lib/db"
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * GET /api/agents/comms - Inter-agent communication stats and timeline
 * Query params: limit, offset, since, agent
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1

    const limit = parseInt(searchParams.get("limit") || "100")
    const offset = parseInt(searchParams.get("offset") || "0")
    const since = searchParams.get("since")
    const agent = searchParams.get("agent")

    // Session-thread comms feed used by coordinator + runtime sessions
    const commsPredicate = `
      (
        conversation_id LIKE 'a2a:%'
        OR conversation_id LIKE 'coord:%'
        OR conversation_id LIKE 'session:%'
        OR conversation_id LIKE 'agent_%'
        OR (json_valid(metadata) AND json_extract(metadata, '$.channel') = 'coordinator-inbox')
      )
    `

    const humanNames = ["human", "system", "operator"]
    const humanPlaceholders = humanNames.map(() => "?").join(",")

    // 1. Get timeline messages (page latest rows but render chronologically)
    let messagesWhere = `
      FROM messages
      WHERE workspace_id = ?
        AND ${commsPredicate}
    `
    const messagesParams: any[] = [workspaceId]

    if (since) {
      messagesWhere += " AND created_at > ?"
      messagesParams.push(parseInt(since, 10))
    }
    if (agent) {
      messagesWhere += " AND (from_agent = ? OR to_agent = ?)"
      messagesParams.push(agent, agent)
    }

    const messagesQuery = `
      SELECT * FROM (
        SELECT *
        ${messagesWhere}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      ) recent
      ORDER BY created_at ASC, id ASC
    `
    messagesParams.push(limit, offset)

    const messages = db.prepare(messagesQuery).all(...messagesParams) as Message[]

    // 2. Communication graph edges
    let graphQuery = `
      SELECT
        from_agent, to_agent,
        COUNT(*) as message_count,
        MAX(created_at) as last_message_at
      FROM messages
      WHERE workspace_id = ?
        AND ${commsPredicate}
        AND to_agent IS NOT NULL
        AND lower(from_agent) NOT IN (${humanPlaceholders})
        AND lower(to_agent) NOT IN (${humanPlaceholders})
    `
    const graphParams: any[] = [workspaceId, ...humanNames, ...humanNames]
    if (since) {
      graphQuery += " AND created_at > ?"
      graphParams.push(parseInt(since, 10))
    }
    graphQuery += " GROUP BY from_agent, to_agent ORDER BY message_count DESC"

    const edges = db.prepare(graphQuery).all(...graphParams)

    // 3. Per-agent sent/received stats
    const statsQuery = `
      SELECT agent, SUM(sent) as sent, SUM(received) as received FROM (
        SELECT from_agent as agent, COUNT(*) as sent, 0 as received
        FROM messages WHERE workspace_id = ?
          AND ${commsPredicate}
          AND to_agent IS NOT NULL
          AND lower(from_agent) NOT IN (${humanPlaceholders})
          AND lower(to_agent) NOT IN (${humanPlaceholders})
        GROUP BY from_agent
        UNION ALL
        SELECT to_agent as agent, 0 as sent, COUNT(*) as received
        FROM messages WHERE workspace_id = ?
          AND ${commsPredicate}
          AND to_agent IS NOT NULL
          AND lower(from_agent) NOT IN (${humanPlaceholders})
          AND lower(to_agent) NOT IN (${humanPlaceholders})
        GROUP BY to_agent
      ) GROUP BY agent ORDER BY (sent + received) DESC
    `
    const statsParams = [workspaceId, ...humanNames, ...humanNames, workspaceId, ...humanNames, ...humanNames]
    const agentStats = db.prepare(statsQuery).all(...statsParams)

    // 4. Total count
    let countQuery = `
      SELECT COUNT(*) as total FROM messages
      WHERE workspace_id = ?
        AND ${commsPredicate}
    `
    const countParams: any[] = [workspaceId]
    if (since) {
      countQuery += " AND created_at > ?"
      countParams.push(parseInt(since, 10))
    }
    if (agent) {
      countQuery += " AND (from_agent = ? OR to_agent = ?)"
      countParams.push(agent, agent)
    }
    const { total } = db.prepare(countQuery).get(...countParams) as { total: number }

    let seededCountQuery = `
      SELECT COUNT(*) as seeded FROM messages
      WHERE workspace_id = ?
        AND ${commsPredicate}
        AND conversation_id LIKE ?
    `
    const seededParams: any[] = [workspaceId, "conv-multi-%"]
    if (since) {
      seededCountQuery += " AND created_at > ?"
      seededParams.push(parseInt(since, 10))
    }
    if (agent) {
      seededCountQuery += " AND (from_agent = ? OR to_agent = ?)"
      seededParams.push(agent, agent)
    }
    const { seeded } = db.prepare(seededCountQuery).get(...seededParams) as { seeded: number }

    const seededCount = seeded || 0
    const liveCount = Math.max(0, total - seededCount)
    const source =
      total === 0 ? "empty" :
      liveCount === 0 ? "seeded" :
      seededCount === 0 ? "live" :
      "mixed"

    const parsed = messages.map((msg) => {
      let parsedMetadata: any = null
      if (msg.metadata) {
        try {
          parsedMetadata = JSON.parse(msg.metadata)
        } catch {
          parsedMetadata = null
        }
      }
      return {
        ...msg,
        metadata: parsedMetadata,
      }
    })

    return NextResponse.json({
      messages: parsed,
      total,
      graph: { edges, agentStats },
      source: { mode: source, seededCount, liveCount },
    })
  } catch (error) {
    logger.error({ err: error }, "GET /api/agents/comms error")
    return NextResponse.json({ error: "Failed to fetch agent communications" }, { status: 500 })
  }
}
