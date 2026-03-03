import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const ICON_DIR = join(homedir(), '.mission-control', 'icons')
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']

/**
 * GET /api/agents/[id]/icon — Get agent icon metadata
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const { id } = await params
  const workspaceId = auth.user.workspace_id ?? 1
  const agent = db.prepare('SELECT id, name, icon_url, icon_color, icon_emoji FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as any

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  return NextResponse.json({
    icon_url: agent.icon_url,
    icon_color: agent.icon_color,
    icon_emoji: agent.icon_emoji,
  })
}

/**
 * POST /api/agents/[id]/icon — Upload an icon image
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const { id } = await params
  const workspaceId = auth.user.workspace_id ?? 1
  const agent = db.prepare('SELECT id FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const contentType = request.headers.get('content-type') || ''
  if (!ALLOWED_TYPES.some(t => contentType.includes(t))) {
    return NextResponse.json({ error: `Unsupported type. Allowed: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
  }

  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
  }

  mkdirSync(ICON_DIR, { recursive: true })
  const ext = contentType.includes('png') ? '.png' : contentType.includes('svg') ? '.svg' : contentType.includes('webp') ? '.webp' : contentType.includes('gif') ? '.gif' : '.jpg'
  const filename = `agent-${id}${ext}`
  writeFileSync(join(ICON_DIR, filename), Buffer.from(body))

  const iconUrl = `/api/agents/${id}/icon/file`
  db.prepare('UPDATE agents SET icon_url = ?, icon_emoji = NULL WHERE id = ? AND workspace_id = ?').run(iconUrl, Number(id), workspaceId)

  return NextResponse.json({ icon_url: iconUrl })
}

/**
 * PATCH /api/agents/[id]/icon — Update emoji or color
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const { id } = await params
  const workspaceId = auth.user.workspace_id ?? 1
  const agent = db.prepare('SELECT id FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await request.json()
  const updates: string[] = []
  const values: any[] = []

  if ('icon_emoji' in body) { updates.push('icon_emoji = ?'); values.push(body.icon_emoji || null) }
  if ('icon_color' in body) { updates.push('icon_color = ?'); values.push(body.icon_color || null) }

  if (body.icon_emoji) {
    // If setting emoji, clear uploaded image
    updates.push('icon_url = NULL')
  }

  if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  values.push(Number(id), workspaceId)
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values)

  return NextResponse.json({ success: true })
}

/**
 * DELETE /api/agents/[id]/icon — Remove custom icon
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const { id } = await params
  const workspaceId = auth.user.workspace_id ?? 1
  const agent = db.prepare('SELECT id, icon_url FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Delete file if exists
  for (const ext of ['.png', '.jpg', '.webp', '.svg', '.gif']) {
    const p = join(ICON_DIR, `agent-${id}${ext}`)
    if (existsSync(p)) unlinkSync(p)
  }

  db.prepare('UPDATE agents SET icon_url = NULL, icon_color = NULL, icon_emoji = NULL WHERE id = ? AND workspace_id = ?').run(Number(id), workspaceId)

  return NextResponse.json({ success: true })
}
