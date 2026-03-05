import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { mirrorOpenClawTasksAndComms } from '@/lib/openclaw-mirror'
import { logger } from '@/lib/logger'

/**
 * Server-side OpenClaw mirror trigger.
 * This endpoint does NOT rely on the browser tick stream.
 * It projects OpenClaw sessions → MC tasks, and mirrors session transcripts → coord threads.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = mirrorOpenClawTasksAndComms()
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/tasks/openclaw-sync error')
    return NextResponse.json({ error: err?.message || 'Mirror failed' }, { status: 500 })
  }
}
