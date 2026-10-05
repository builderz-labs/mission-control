import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { deleteSocialAccount, rotateSocialCredential, type SocialCredentialPayload } from '@/lib/social-credential-vault'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ accountId: string }> }

const credentialSchema = z.object({
  access_token: z.string().min(1).max(32768).optional(),
  refresh_token: z.string().min(1).max(32768).optional(),
  client_secret: z.string().min(1).max(32768).optional(),
  token_type: z.string().min(1).max(32768).optional(),
}).strict().refine((value) => Boolean(value.access_token || value.refresh_token || value.client_secret))

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const { accountId } = await context.params
  if (!z.string().uuid().safeParse(accountId).success) {
    return NextResponse.json({ error: 'Invalid social account reference' }, { status: 400 })
  }
  const parsed = z.object({ credential: credentialSchema }).strict().safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid credential rotation request' }, { status: 400 })
  }

  try {
    const credential: SocialCredentialPayload = parsed.data.credential
    const account = rotateSocialCredential(getDatabase(), ws.workspaceId, auth.user.username, accountId, credential)
    return NextResponse.json({ account })
  } catch {
    return NextResponse.json({ error: 'Social credential could not be rotated securely' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const { accountId } = await context.params
  if (!z.string().uuid().safeParse(accountId).success) {
    return NextResponse.json({ error: 'Invalid social account reference' }, { status: 400 })
  }

  try {
    if (!deleteSocialAccount(getDatabase(), ws.workspaceId, auth.user.username, accountId)) {
      return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Social account could not be removed' }, { status: 500 })
  }
}
