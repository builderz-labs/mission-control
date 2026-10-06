import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { getSocialOAuthProfile, completeSocialOAuth } from '@/lib/social-oauth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const { provider } = await context.params
  if (!getSocialOAuthProfile(provider)) return NextResponse.json({ error: 'Unknown social provider' }, { status: 404 })
  const query = new URL(request.url).searchParams
  try {
    const result = await completeSocialOAuth(getDatabase(), ws.workspaceId, provider as any, {
      state: query.get('state'), code: query.get('code'), error: query.get('error'),
    })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'OAuth callback could not be completed; start a new authorization attempt' }, { status: 400 })
  }
}
