import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { executeIntervention } from '@/lib/intervention-executor'
import { Session } from '@/types'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { action } = await request.json()
    const db = getDatabase()
    const session = db.prepare('SELECT * FROM claude_sessions WHERE session_id = ?').get(params.id) as Session | undefined

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const result = await executeIntervention(
      session.session_id,
      session.project_slug,
      action as any,
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
