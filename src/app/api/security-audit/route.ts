import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runSecurityAudit } from '@/lib/security-audit'
import type { AuditResult } from '@/lib/security-audit'
import { heavyLimiter } from '@/lib/rate-limit'

let lastResult: AuditResult | null = null

/**
 * GET /api/security-audit - Get latest audit results (or run if none cached)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (lastResult) {
    return NextResponse.json(lastResult)
  }

  const result = await runSecurityAudit()
  lastResult = result
  return NextResponse.json(result)
}

/**
 * POST /api/security-audit - Trigger a fresh audit
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const result = await runSecurityAudit()
  lastResult = result
  return NextResponse.json(result)
}
