import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { deleteSocialAccount, rotateSocialCredential, type SocialCredentialPayload } from '@/lib/social-credential-vault'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ accountId: string }> }

export async function PUT(request: Request, context: RouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { accountId } = await context.params
    const body = await request.json() as { credential: SocialCredentialPayload }
    const account = rotateSocialCredential(getDatabase(), auth.user.workspace_id, auth.user.username, accountId, body?.credential)
    return NextResponse.json({ account })
  } catch {
    return NextResponse.json({ error: 'Unable to rotate social credential' }, { status: 400 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const { accountId } = await context.params
    if (!deleteSocialAccount(getDatabase(), auth.user.workspace_id, auth.user.username, accountId)) {
      return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Unable to delete social account' }, { status: 500 })
  }
}
