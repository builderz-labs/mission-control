import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

const ICON_DIR = join(process.cwd(), '.data', 'agent-icons')
const MAX_ICON_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']

/**
 * GET /api/agents/[id]/icon — Get agent icon metadata
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const db = getDatabase()
  const agent = db.prepare('SELECT id, name, icon_url, icon_color, icon_emoji FROM agents WHERE id = ?').get(Number(id)) as any

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  return NextResponse.json({
    id: agent.id,
    name: agent.name,
    icon_url: agent.icon_url,
    icon_color: agent.icon_color,
    icon_emoji: agent.icon_emoji,
  })
}

/**
 * POST /api/agents/[id]/icon — Upload agent icon image
 * Accepts multipart/form-data with field "icon" (image file)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const agentId = Number(id)
  const db = getDatabase()

  const agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(agentId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  try {
    const formData = await request.formData()
    const file = formData.get('icon') as File | null

    if (!file) return NextResponse.json({ error: 'No icon file provided' }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
    }
    if (file.size > MAX_ICON_SIZE) {
      return NextResponse.json({ error: `File too large. Max: ${MAX_ICON_SIZE / 1024 / 1024}MB` }, { status: 400 })
    }

    mkdirSync(ICON_DIR, { recursive: true })

    const ext = file.type.split('/')[1] === 'svg+xml' ? 'svg' : file.type.split('/')[1]
    const filename = `agent-${agentId}.${ext}`
    const filepath = join(ICON_DIR, filename)

    const buffer = Buffer.from(await file.arrayBuffer())
    writeFileSync(filepath, buffer)

    const iconUrl = `/api/agents/${agentId}/icon/file`
    db.prepare('UPDATE agents SET icon_url = ?, updated_at = unixepoch() WHERE id = ?').run(iconUrl, agentId)

    logger.info({ agentId, filename }, 'Agent icon uploaded')

    return NextResponse.json({ ok: true, icon_url: iconUrl })
  } catch (error) {
    logger.error({ err: error, agentId }, 'Failed to upload agent icon')
    return NextResponse.json({ error: 'Failed to upload icon' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]/icon — Update agent avatar color or emoji
 * Body: { icon_color?: string, icon_emoji?: string }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const agentId = Number(id)
  const db = getDatabase()

  const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  try {
    const body = await request.json()
    const { icon_color, icon_emoji } = body

    const updates: string[] = []
    const values: any[] = []

    if (icon_color !== undefined) {
      updates.push('icon_color = ?')
      values.push(icon_color || null)
    }
    if (icon_emoji !== undefined) {
      updates.push('icon_emoji = ?')
      values.push(icon_emoji || null)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    updates.push('updated_at = unixepoch()')
    values.push(agentId)

    db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ err: error, agentId }, 'Failed to update agent avatar')
    return NextResponse.json({ error: 'Failed to update avatar' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]/icon — Remove custom agent icon
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const agentId = Number(id)
  const db = getDatabase()

  const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Remove file if it exists
  for (const ext of ['png', 'jpeg', 'webp', 'svg', 'gif']) {
    const filepath = join(ICON_DIR, `agent-${agentId}.${ext}`)
    if (existsSync(filepath)) {
      try { unlinkSync(filepath) } catch { /* ignore */ }
    }
  }

  db.prepare('UPDATE agents SET icon_url = NULL, icon_emoji = NULL, updated_at = unixepoch() WHERE id = ?').run(agentId)

  return NextResponse.json({ ok: true })
}
