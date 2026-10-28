import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  deleteSocialAccount,
  listSocialAccounts,
  putSocialAccount,
  rotateSocialCredential,
  type SocialAccountInput,
  type SocialCredentialPayload,
} from '@/lib/social-credential-vault'
import { listOAuthAppConfigs } from '@/lib/social-oauth'

export const runtime = 'nodejs'

const credentialSchema = z.object({
  access_token: z.string().min(1).max(32768).optional(),
  refresh_token: z.string().min(1).max(32768).optional(),
  client_secret: z.string().min(1).max(32768).optional(),
  token_type: z.string().min(1).max(32768).optional(),
}).strict().refine((value) => Boolean(value.access_token || value.refresh_token || value.client_secret))
const accountSchema = z.object({
  provider: z.enum(['instagram', 'tiktok', 'linkedin', 'x', 'reddit']),
  account_ref: z.string().trim().min(1).max(200),
  external_account_id: z.string().max(300).nullable().optional(),
  account_mode: z.string().max(100).nullable().optional(),
  status: z.enum(['PENDING', 'CONNECTED', 'EXPIRED', 'REAUTH_REQUIRED', 'DISCONNECTED']).optional(),
  scopes: z.array(z.string().max(200)).max(200).optional(),
  expires_at: z.number().int().nonnegative().nullable().optional(),
  refreshable: z.boolean().optional(),
  credential: credentialSchema,
}).strict()
const rotationSchema = z.object({ account_id: z.string().uuid(), credential: credentialSchema }).strict()

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  try {
    const db = getDatabase()
    const apps = listOAuthAppConfigs(db, ws.workspaceId)
    const configured = new Set(apps.filter((app) => app.status === 'configured').map((app) => app.provider))
    return NextResponse.json({
      accounts: listSocialAccounts(db, ws.workspaceId),
      provider_configuration: ['instagram', 'tiktok', 'linkedin', 'x', 'reddit'].map((provider) => ({ provider, configured: configured.has(provider as any) })),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch social accounts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = accountSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid social account or credential payload' }, { status: 400 })
  try {
    const accountInput: SocialAccountInput = parsed.data
    const account = putSocialAccount(getDatabase(), ws.workspaceId, auth.user.username, accountInput)
    return NextResponse.json({ account }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Social account could not be saved securely' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = rotationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid credential rotation request' }, { status: 400 })
  try {
    const credential: SocialCredentialPayload = parsed.data.credential
    const account = rotateSocialCredential(getDatabase(), ws.workspaceId, auth.user.username, parsed.data.account_id, credential)
    return NextResponse.json({ account })
  } catch {
    return NextResponse.json({ error: 'Social credential could not be rotated securely' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const accountId = new URL(request.url).searchParams.get('account_id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return NextResponse.json({ error: 'Invalid social account reference' }, { status: 400 })
  try {
    const db = getDatabase()
    const deleted = deleteSocialAccount(db, ws.workspaceId, auth.user.username, accountId)
    if (!deleted) return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
    return NextResponse.json({ deleted })
  } catch {
    return NextResponse.json({ error: 'Social account could not be removed' }, { status: 500 })
  }
}
