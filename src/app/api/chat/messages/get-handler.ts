import { SqlParam } from '@/lib/types/sql'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, type Message } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/** Safe JSON parse that returns null instead of throwing */
export function safeParseMetadata(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * GET /api/chat/messages
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function handleGetMessages(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query =
      'SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at, workspace_id FROM messages WHERE workspace_id = ?'
    const params: SqlParam[] = [workspaceId]

    if (conversation_id) {
      query += ' AND conversation_id = ?'
      params.push(conversation_id)
    }
    if (from_agent) {
      query += ' AND from_agent = ?'
      params.push(from_agent)
    }
    if (to_agent) {
      query += ' AND to_agent = ?'
      params.push(to_agent)
    }
    if (since) {
      query += ' AND created_at > ?'
      params.push(parseInt(since))
    }
    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const messages = db.prepare(query).all(...params) as Message[]
    const parsed = messages.map((msg) => ({
      ...msg,
      metadata: safeParseMetadata(msg.metadata),
    }))

    // Build count query with identical filters for pagination metadata
    let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE workspace_id = ?'
    const countParams: SqlParam[] = [workspaceId]
    if (conversation_id) {
      countQuery += ' AND conversation_id = ?'
      countParams.push(conversation_id)
    }
    if (from_agent) {
      countQuery += ' AND from_agent = ?'
      countParams.push(from_agent)
    }
    if (to_agent) {
      countQuery += ' AND to_agent = ?'
      countParams.push(to_agent)
    }
    if (since) {
      countQuery += ' AND created_at > ?'
      countParams.push(parseInt(since))
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({
      messages: parsed,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}
