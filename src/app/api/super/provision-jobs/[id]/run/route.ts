import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { executeProvisionJob } from '@/lib/super-admin'

/**
 * POST /api/super/provision-jobs/[id]/run - Execute an approved provisioning job
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
    const job = await executeProvisionJob(id, auth.user.username)
    return NextResponse.json({ job })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to execute provisioning job' }, { status: 400 })
  }
}
