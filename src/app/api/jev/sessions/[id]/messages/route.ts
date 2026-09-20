import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { jevErrorResponse } from '@/lib/jev-route-error'
import {
  getJevSetupSession,
  listJevSetupMessages,
} from '@/lib/jev-setup-session-repository'
import { readLimiter } from '@/lib/rate-limit'

type Context = { params: Promise<{ id: string }> }

function boundedInteger(value: string | null, fallback: number, max: number): number | null {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

export async function GET(request: NextRequest, context: Context) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited
  const id = z.string().uuid().safeParse((await context.params).id)
  const query = new URL(request.url).searchParams
  const limit = boundedInteger(query.get('limit'), 100, 200)
  const afterOrdinal = boundedInteger(query.get('afterOrdinal'), 0, 2_147_483_647)
  if (!id.success || limit === null || limit === 0 || afterOrdinal === null) {
    return NextResponse.json({ error: 'Invalid message list query' }, { status: 400 })
  }
  try {
    const session = getJevSetupSession(
      id.data,
      auth.user.workspace_id,
      auth.user.tenant_id,
    )
    return NextResponse.json({
      messages: listJevSetupMessages(session, limit, afterOrdinal),
    })
  } catch (error) {
    return jevErrorResponse(error, 'list Jev setup messages')
  }
}
