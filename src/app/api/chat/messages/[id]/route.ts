import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Message } from '@/lib/db'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/chat/messages/[id] - Get a single message
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(parseInt(id)) as Message | undefined

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    return NextResponse.json({
      message: {
        ...message,
        metadata: message.metadata ? JSON.parse(message.metadata) : null
      }
    })
  } catch (error) {
    console.error('GET /api/chat/messages/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch message' }, { status: 500 })
  }
}

/**
 * PATCH /api/chat/messages/[id] - Mark message as read
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const body = await request.json()

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(parseInt(id)) as Message | undefined

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (body.read) {
      const now = Math.floor(Date.now() / 1000)
      db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(now, parseInt(id))
    }

    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(parseInt(id)) as Message

    return NextResponse.json({
      message: {
        ...updated,
        metadata: updated.metadata ? JSON.parse(updated.metadata) : null
      }
    })
  } catch (error) {
    console.error('PATCH /api/chat/messages/[id] error:', error)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
