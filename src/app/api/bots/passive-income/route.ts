import { NextRequest, NextResponse } from 'next/server'
import { runBot, type PassiveIncomeBotError, type EvidenceSignals } from '@/lib/server/passive-income-bot-wrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── In-memory rate limiter: 5 requests per IP per 60s ────────────────────────

const WINDOW_MS  = 60_000
const MAX_CALLS  = 5

interface WindowEntry { count: number; windowStart: number }
const _limiter = new Map<string, WindowEntry>()

function checkRateLimit(ip: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
  const entry = _limiter.get(ip)
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    _limiter.set(ip, { count: 1, windowStart: now })
    return { allowed: true, retryAfter: 0 }
  }
  if (entry.count >= MAX_CALLS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000)
    return { allowed: false, retryAfter }
  }
  entry.count += 1
  return { allowed: true, retryAfter: 0 }
}

// Exported for tests
export { checkRateLimit, _limiter }

// ─────────────────────────────────────────────────────────────────────────────

interface PassiveIncomeRequest {
  niche: string
  task_id?: string
  evidence_signals?: EvidenceSignals
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || request.headers.get('x-real-ip')
            || 'unknown'

    const { allowed, retryAfter } = checkRateLimit(ip)
    if (!allowed) {
      return NextResponse.json(
        { error: 'rate_limit_exceeded', retry_after: retryAfter },
        { status: 429 }
      )
    }

    const body = await request.json() as PassiveIncomeRequest

    if (!body.niche || typeof body.niche !== 'string') {
      return NextResponse.json(
        { error: 'niche is required and must be a string' },
        { status: 400 }
      )
    }
    if (body.niche.trim().length === 0) {
      return NextResponse.json(
        { error: 'niche must not be empty' },
        { status: 400 }
      )
    }
    if (body.niche.length > 500) {
      return NextResponse.json(
        { error: 'niche must be 500 characters or fewer' },
        { status: 400 }
      )
    }

    const result = runBot({
      niche: body.niche.trim(),
      task_id: body.task_id,
      evidence_signals: body.evidence_signals,
    })

    if ('error' in result) {
      return NextResponse.json(
        { error: (result as PassiveIncomeBotError).error },
        { status: 400 }
      )
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('Passive income bot error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
