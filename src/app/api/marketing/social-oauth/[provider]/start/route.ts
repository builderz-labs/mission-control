import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { getSocialOAuthProfile, startSocialOAuth } from '@/lib/social-oauth'

export const runtime = 'nodejs'
const bodySchema = z.object({ account_mode: z.string().max(100).optional() }).strict().optional()

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const { provider } = await context.params
  if (!getSocialOAuthProfile(provider)) return NextResponse.json({ error: 'Unknown social provider' }, { status: 404 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid OAuth start request' }, { status: 400 })
  try {
    const result = startSocialOAuth(getDatabase(), ws.workspaceId, auth.user.username, provider as any, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'OAuth app is not configured or transaction could not be created' }, { status: 400 })
  }
}
