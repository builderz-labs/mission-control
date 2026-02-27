import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/chat/conversations - List conversations derived from messages
 * Query params: agent (filter by participant), limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)

    const agent = searchParams.get('agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let query: string
    const params: any[] = []

    if (agent) {
      // Get conversations where this agent is a participant
      query = `
        SELECT
          m.conversation_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          COUNT(DISTINCT m.from_agent) + COUNT(DISTINCT CASE WHEN m.to_agent IS NOT NULL THEN m.to_agent END) as participant_count,
          SUM(CASE WHEN m.to_agent = ? AND m.read_at IS NULL THEN 1 ELSE 0 END) as unread_count
        FROM messages m
        WHERE m.from_agent = ? OR m.to_agent = ? OR m.to_agent IS NULL
        GROUP BY m.conversation_id
        ORDER BY last_message_at DESC
        LIMIT ? OFFSET ?
      `
      params.push(agent, agent, agent, limit, offset)
    } else {
      query = `
        SELECT
          m.conversation_id,
          MAX(m.created_at) as last_message_at,
          COUNT(*) as message_count,
          COUNT(DISTINCT m.from_agent) + COUNT(DISTINCT CASE WHEN m.to_agent IS NOT NULL THEN m.to_agent END) as participant_count,
          0 as unread_count
        FROM messages m
        GROUP BY m.conversation_id
        ORDER BY last_message_at DESC
        LIMIT ? OFFSET ?
      `
      params.push(limit, offset)
    }

    const conversations = db.prepare(query).all(...params) as any[]

    // Prepare last message statement once (avoids N+1)
    const lastMsgStmt = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const withLastMessage = conversations.map((conv) => {
      const lastMsg = lastMsgStmt.get(conv.conversation_id) as any;

      return {
        ...conv,
        last_message: lastMsg
          ? {
              ...lastMsg,
              metadata: lastMsg.metadata ? JSON.parse(lastMsg.metadata) : null
            }
          : null
      }
    })

    // Get total count for pagination
    let countQuery: string
    const countParams: any[] = []
    if (agent) {
      countQuery = `
        SELECT COUNT(DISTINCT m.conversation_id) as total
        FROM messages m
        WHERE m.from_agent = ? OR m.to_agent = ? OR m.to_agent IS NULL
      `
      countParams.push(agent, agent)
    } else {
      countQuery = 'SELECT COUNT(DISTINCT conversation_id) as total FROM messages'
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({ conversations: withLastMessage, total: countRow.total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    console.error('GET /api/chat/conversations error:', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}
