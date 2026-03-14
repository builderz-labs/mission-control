import { NextResponse } from 'next/server'
import { db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { virtualOfficeDb } from '@/lib/virtual-office-db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = requireRole(request, 'viewer')
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const chatHistory = virtualOfficeDb.getRecentMessages()
  return NextResponse.json({ chatHistory })
}

export async function POST(request: Request) {
  const auth = requireRole(request, 'operator')
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { agent, message, type = 'text', thinking } = body

    if (!agent || !message) {
      return NextResponse.json({ error: 'Agent and message are required' }, { status: 400 })
    }

    const newMessage = {
      id: Date.now().toString(),
      agent,
      message,
      type,
      thinking,
      timestamp: new Date().toISOString(),
    }

    // Persist to database
    virtualOfficeDb.insertMessage(newMessage)

    // Broadcast to the UI (SSE via /api/virtual-office/stream)
    eventBus.broadcast('virtual-office.message', newMessage)
    
    // Log the interaction
    db_helpers.logActivity(
      'virtual_office_interaction',
      'agent',
      0, // Virtual entity
      agent,
      `Agent ${agent} spoke in Virtual Office: ${type === 'tool' ? 'used tool' : 'sent message'}`
    )

    return NextResponse.json({ success: true, message: newMessage })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const auth = requireRole(request, 'admin')
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  virtualOfficeDb.clearAll()
  eventBus.broadcast('virtual-office.cleared', {})
  return NextResponse.json({ success: true })
}
