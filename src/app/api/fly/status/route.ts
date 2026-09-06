import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { flySubmissionStatus } from '@/lib/fly-admission'
import { flyReadiness } from '@/lib/fly-admission-schema'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const id = request.nextUrl.searchParams.get('submission_id') || undefined
  if (id && !/^[a-f0-9]{32}$/.test(id)) return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 })
  try {
    const issues = flyReadiness()
    return NextResponse.json({ ready: !issues.length, issues, transport: 'polled', cost_basis: 'estimated Fly compute; excludes inference, storage and egress',
      submissions: flySubmissionStatus(getDatabase(), auth.user.workspace_id, id) })
  } catch {
    return NextResponse.json({ error: 'Fly status is unavailable' }, { status: 503 })
  }
}
