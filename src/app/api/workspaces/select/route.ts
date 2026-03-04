import { NextRequest, NextResponse } from 'next/server'
import { getMcSessionCookieOptions } from '@/lib/session-cookie'
import { requireRole } from '@/lib/auth'
import { parseWorkspaceId, workspaceExists } from '@/lib/workspace'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const workspaceId = parseWorkspaceId(String(body?.workspace_id || ''))
  if (!workspaceId || !workspaceExists(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 })
  }

  const response = NextResponse.json({ success: true, workspace_id: workspaceId })
  const isSecureRequest = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:'
  response.cookies.set('mc-workspace-id', String(workspaceId), {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 7 * 24 * 60 * 60, isSecureRequest }),
  })
  return response
}
