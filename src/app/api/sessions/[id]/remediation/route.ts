import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getRemediationSuggestion } from '@/lib/remediation'
import { Session } from '@/types'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDatabase()
    const session = db.prepare('SELECT * FROM claude_sessions WHERE session_id = ?').get(params.id) as Session | undefined

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Stability score might be stored as real in DB, but types expect number
    const suggestion = getRemediationSuggestion(session)

    return NextResponse.json(suggestion)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
