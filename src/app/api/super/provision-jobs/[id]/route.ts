import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getProvisionJob, transitionProvisionJobStatus, ProvisionJobAction } from '@/lib/super-admin'

/**
 * GET /api/super/provision-jobs/[id] - Get job details and events
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const params = await context.params
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }

  const job = getProvisionJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({ job })
}

/**
 * POST /api/super/provision-jobs/[id] - Change job approval state
 * Body: { action: 'approve' | 'reject' | 'cancel', reason?: string }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const params = await context.params
  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '') as ProvisionJobAction
    const reason = body?.reason ? String(body.reason) : undefined

    if (!['approve', 'reject', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Use approve, reject, or cancel.' }, { status: 400 })
    }

    const job = transitionProvisionJobStatus(id, auth.user.username, action, reason)
    return NextResponse.json({ job })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update provisioning job state' }, { status: 400 })
  }
}
