import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getRemediationSuggestion } from '@/lib/remediation'
import { Session } from '@/types'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getDatabase()
    const session = db.prepare('SELECT * FROM claude_sessions WHERE session_id = ?').get(id) as Session | undefined

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const suggestion = getRemediationSuggestion(session)
    return NextResponse.json(suggestion)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
