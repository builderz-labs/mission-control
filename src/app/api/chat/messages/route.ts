import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query = 'SELECT * FROM messages WHERE 1=1'
    const params: any[] = []

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
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null
    }))

    return NextResponse.json({ messages: parsed, total: parsed.length })
  } catch (error) {
    console.error('GET /api/chat/messages error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/chat/messages - Send a new message
 * Body: { from, to, content, message_type, conversation_id, metadata }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()

    const from = (body.from || '').trim()
    const to = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null

    if (!from || !content) {
      return NextResponse.json(
        { error: '"from" and "content" are required' },
        { status: 400 }
      )
    }

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      content,
      message_type,
      metadata ? JSON.stringify(metadata) : null
    )

    const messageId = result.lastInsertRowid as number

    // Log activity
    db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type }
    )

    // Create notification for recipient if specified
    if (to) {
      db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        'message',
        messageId
      )

      // Optionally forward to agent via gateway
      if (body.forward) {
        const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(to) as any
        if (agent?.session_key) {
          try {
            await runOpenClaw(
              [
                'gateway',
                'sessions_send',
                '--session',
                agent.session_key,
                '--message',
                `Message from ${from}: ${content}`
              ],
              { timeoutMs: 10000 }
            )
          } catch (err) {
            console.error('Failed to forward message via gateway:', err)
          }
        }
      }
    }

    const created = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Message
    const parsedMessage = {
      ...created,
      metadata: created.metadata ? JSON.parse(created.metadata) : null
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json({ message: parsedMessage }, { status: 201 })
  } catch (error) {
    console.error('POST /api/chat/messages error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
