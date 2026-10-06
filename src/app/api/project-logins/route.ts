import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { createProjectLogin, deleteProjectLogin, listProjectLogins, updateProjectLogin } from '@/lib/project-login-vault'

export const runtime = 'nodejs'

const entrySchema = z.object({
  project_id: z.number().int().positive(),
  service: z.string().trim().min(1).max(200),
  login_url: z.string().max(2048).nullable().optional(),
  username: z.string().trim().min(1).max(320),
  password: z.string().max(32768).optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict()
const createSchema = entrySchema.extend({ password: z.string().min(1).max(32768) }).strict()
const updateSchema = entrySchema.extend({ project_id: z.number().int().positive().optional(), login_id: z.string().uuid() }).strict()

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const projectId = Number(new URL(request.url).searchParams.get('project_id'))
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return NextResponse.json({ error: 'A project is required' }, { status: 400 })
  try { return NextResponse.json({ logins: listProjectLogins(getDatabase(), ws.workspaceId, projectId) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return NextResponse.json({ error: 'Unable to load project logins' }, { status: 404 }) }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid project login entry' }, { status: 400 })
  try {
    const login = createProjectLogin(getDatabase(), ws.workspaceId, auth.user.username, parsed.data)
    return NextResponse.json({ login }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Project login could not be saved securely' }, { status: 400 }) }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid project login entry' }, { status: 400 })
  const { login_id, ...input } = parsed.data
  try {
    const login = updateProjectLogin(getDatabase(), ws.workspaceId, auth.user.username, login_id, input)
    return NextResponse.json({ login }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Project login could not be updated securely' }, { status: 400 }) }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const loginId = new URL(request.url).searchParams.get('login_id') || ''
  if (!z.string().uuid().safeParse(loginId).success) return NextResponse.json({ error: 'Invalid project login reference' }, { status: 400 })
  try {
    const deleted = deleteProjectLogin(getDatabase(), ws.workspaceId, auth.user.username, loginId)
    return deleted ? NextResponse.json({ deleted }) : NextResponse.json({ error: 'Project login not found' }, { status: 404 })
  } catch { return NextResponse.json({ error: 'Project login could not be removed' }, { status: 500 }) }
}
