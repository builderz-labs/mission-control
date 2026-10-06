import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { revealProjectLoginPassword } from '@/lib/project-login-vault'

export const runtime = 'nodejs'
const noStore = { 'Cache-Control': 'no-store, private', Pragma: 'no-cache' }

export async function POST(request: NextRequest, context: { params: Promise<{ loginId: string }> }) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: noStore })
  const rate = mutationLimiter(request)
  if (rate) return NextResponse.json({ error: 'Too many reveal attempts' }, { status: 429, headers: noStore })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return NextResponse.json({ error: 'Workspace context required' }, { status: 400, headers: noStore })
  const { loginId } = await context.params
  if (!z.string().uuid().safeParse(loginId).success) return NextResponse.json({ error: 'Project login not found' }, { status: 404, headers: noStore })
  try {
    const password = revealProjectLoginPassword(getDatabase(), ws.workspaceId, auth.user.username, loginId)
    return NextResponse.json({ password }, { headers: noStore })
  } catch { return NextResponse.json({ error: 'Project login password could not be revealed' }, { status: 404, headers: noStore }) }
}
