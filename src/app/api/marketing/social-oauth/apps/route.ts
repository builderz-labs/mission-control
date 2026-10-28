import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { listOAuthAppConfigs, saveOAuthAppConfig } from '@/lib/social-oauth'

export const runtime = 'nodejs'

const configSchema = z.object({
  provider: z.enum(['instagram', 'tiktok', 'linkedin', 'x', 'reddit']),
  client_id: z.string().trim().min(1).max(500),
  client_secret: z.string().min(1).max(32768).optional(),
  redirect_uri: z.string().url().max(2000),
  scopes: z.array(z.string().max(200)).max(100).optional(),
  options: z.record(z.string(), z.union([z.string().max(300), z.boolean()])).optional(),
}).strict()

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  try { return NextResponse.json({ apps: listOAuthAppConfigs(getDatabase(), ws.workspaceId) }) }
  catch { return NextResponse.json({ error: 'Failed to fetch OAuth app configuration' }, { status: 500 }) }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = configSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid OAuth app configuration' }, { status: 400 })
  try {
    const app = saveOAuthAppConfig(getDatabase(), ws.workspaceId, auth.user.username, parsed.data)
    return NextResponse.json({ app })
  } catch {
    return NextResponse.json({ error: 'OAuth app configuration could not be saved securely' }, { status: 400 })
  }
}
