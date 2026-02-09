import { NextRequest, NextResponse } from "next/server"
import { getDatabase, Message } from "@/lib/db"

/**
 * GET /api/agents/comms - Inter-agent communication stats and timeline
 * Query params: limit, offset, since, agent
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)

    const limit = parseInt(searchParams.get("limit") || "100")
    const offset = parseInt(searchParams.get("offset") || "0")
    const since = searchParams.get("since")
    const agent = searchParams.get("agent")

    // Filter out human/system messages - only agent-to-agent
    const humanNames = ["human", "nyk", "system", "operator"]
    const humanPlaceholders = humanNames.map(() => "?").join(",")

    // 1. Get inter-agent messages
    let messagesQuery = `
      SELECT * FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
    `
    const messagesParams: any[] = [...humanNames, ...humanNames]

    if (since) {
      messagesQuery += " AND created_at > ?"
      messagesParams.push(parseInt(since))
    }
    if (agent) {
      messagesQuery += " AND (from_agent = ? OR to_agent = ?)"
      messagesParams.push(agent, agent)
    }

    messagesQuery += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    messagesParams.push(limit, offset)

    const messages = db.prepare(messagesQuery).all(...messagesParams) as Message[]

    // 2. Communication graph edges
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
    const graphParams: any[] = [...humanNames, ...humanNames]
    if (since) {
      graphQuery += " AND created_at > ?"
      graphParams.push(parseInt(since))
    }
    graphQuery += " GROUP BY from_agent, to_agent ORDER BY message_count DESC"

    const edges = db.prepare(graphQuery).all(...graphParams)

    // 3. Per-agent sent/received stats
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

    // 4. Total count
    let countQuery = `
      SELECT COUNT(*) as total FROM messages
      WHERE to_agent IS NOT NULL
        AND from_agent NOT IN (${humanPlaceholders})
        AND to_agent NOT IN (${humanPlaceholders})
    `
    const countParams: any[] = [...humanNames, ...humanNames]
    if (since) {
      countQuery += " AND created_at > ?"
      countParams.push(parseInt(since))
    }
    if (agent) {
      countQuery += " AND (from_agent = ? OR to_agent = ?)"
      countParams.push(agent, agent)
    }
    const { total } = db.prepare(countQuery).get(...countParams) as { total: number }

    const parsed = messages.map((msg) => ({
      ...msg,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
    }))

    return NextResponse.json({ messages: parsed, total, graph: { edges, agentStats } })
  } catch (error) {
    console.error("GET /api/agents/comms error:", error)
    return NextResponse.json({ error: "Failed to fetch agent communications" }, { status: 500 })
  }
}
