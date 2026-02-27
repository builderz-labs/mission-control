import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runClawdbot } from '@/lib/command'
import { db_helpers } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const { action } = await request.json()

    if (!['monitor', 'pause', 'terminate'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: monitor, pause, terminate' },
        { status: 400 }
      )
    }

    let result
    if (action === 'terminate') {
      result = await runClawdbot(
        ['-c', `sessions_kill("${id}")`],
        { timeoutMs: 10000 }
      )
    } else {
      const message = action === 'monitor'
        ? JSON.stringify({ type: 'control', action: 'monitor' })
        : JSON.stringify({ type: 'control', action: 'pause' })
      result = await runClawdbot(
        ['-c', `sessions_send("${id}", ${JSON.stringify(message)})`],
        { timeoutMs: 10000 }
      )
    }

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Session ${action}: ${id}`,
      { session_key: id, action }
    )

    return NextResponse.json({
      success: true,
      action,
      session: id,
      stdout: result.stdout.trim(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Session control failed' },
      { status: 500 }
    )
  }
}
