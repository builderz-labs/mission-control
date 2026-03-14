import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { executeIntervention } from '@/lib/intervention-executor'
import { Session } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body

    if (!action || !['ROLLBACK', 'HANDOFF', 'FORCE_SYNC', 'RESCAN'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be ROLLBACK, HANDOFF, FORCE_SYNC, or RESCAN' }, { status: 400 })
    }

    const db = getDatabase()
    const session = db.prepare('SELECT * FROM claude_sessions WHERE session_id = ?').get(id) as Session | undefined

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const result = await executeIntervention(
      session.session_id,
      session.project_slug,
      action as 'ROLLBACK' | 'HANDOFF' | 'FORCE_SYNC' | 'RESCAN',
      session.project_path || ''
    )

    if (result.success) {
      return NextResponse.json(result)
    } else {
      return NextResponse.json(result, { status: 500 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
