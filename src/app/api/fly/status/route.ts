import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { flySubmissionStatus } from '@/lib/fly-admission'
import { flyReadiness } from '@/lib/fly-admission-schema'
import { releaseQueuedFlySubmission } from '@/lib/fly-queue-control'
import { mutationLimiter } from '@/lib/rate-limit'
import { buildFlyActivity } from '@/lib/fly-activity'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const id = request.nextUrl.searchParams.get('submission_id') || undefined
  const session = request.nextUrl.searchParams.get('session_id')
  if (session !== null && (!session.length || session.length > 200)) return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
  if (id && !/^[a-f0-9]{32}$/.test(id)) return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 })
  try {
    const issues = flyReadiness()
    return NextResponse.json({ ready: !issues.length, issues, transport: 'polled', cost_basis: 'estimated Fly compute; excludes inference, storage and egress',
      readiness_basis: 'Configuration only; commission a real canary before relying on provider connectivity',
      activity: buildFlyActivity(getDatabase(),auth.user.workspace_id,session),
      submissions: flySubmissionStatus(getDatabase(), auth.user.workspace_id, id, session) })
  } catch {
    return NextResponse.json({ error: 'Fly status is unavailable' }, { status: 503 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const id = request.nextUrl.searchParams.get('submission_id') || ''
  if (!/^[a-f0-9]{32}$/.test(id)) return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 })
  try {
    const result = releaseQueuedFlySubmission(getDatabase(),auth.user.workspace_id,id,'cancelled')
    return NextResponse.json(result,{ status: result.released ? 200 : 409 })
  } catch {
    return NextResponse.json({ error: 'Cancellation unconfirmed; remote ownership retained' },{ status: 503 })
  }
}
