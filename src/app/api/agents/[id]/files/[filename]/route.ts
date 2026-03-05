import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { getUserFromRequest, requireRole } from '@/lib/auth'
import {
  getAgentWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
  isAllowedFile,
} from '@/lib/agent-workspace'

/**
 * GET /api/agents/[id]/files/[filename] - Read a specific workspace file
 * Filename can be e.g. "SOUL.md", "IDENTITY.md", or "memory/2026-03-01.md"
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const filename = decodeURIComponent(resolvedParams.filename)

    // Whitelist check
    if (!isAllowedFile(filename)) {
      return NextResponse.json({ error: 'File not in whitelist' }, { status: 403 })
    }

    // Get agent by ID or name
    let agent: any
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT id, name FROM agents WHERE name = ?').get(agentId)
    } else {
      agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(Number(agentId))
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspace = getAgentWorkspace(agentId)
    if (!workspace) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 404 })
    }

    const content = readWorkspaceFile(workspace, filename)
    if (content === null) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      filename,
      content,
      size: content.length,
      readonly: filename === 'USER.md',
    })
  } catch (error: any) {
    if (error.message === 'Path escapes workspace directory') {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }
    console.error('GET /api/agents/[id]/files/[filename] error:', error)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id]/files/[filename] - Write a specific workspace file
 * USER.md is read-only (rejected here).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const filename = decodeURIComponent(resolvedParams.filename)

    // Whitelist check
    if (!isAllowedFile(filename)) {
      return NextResponse.json({ error: 'File not in whitelist' }, { status: 403 })
    }

    // USER.md is read-only
    if (filename === 'USER.md') {
      return NextResponse.json({ error: 'USER.md is read-only' }, { status: 403 })
    }

    // Get agent by ID or name
    let agent: any
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT id, name FROM agents WHERE name = ?').get(agentId)
    } else {
      agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(Number(agentId))
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspace = getAgentWorkspace(agentId)
    if (!workspace) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 404 })
    }

    const body = await request.json()
    const { content } = body
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    writeWorkspaceFile(workspace, filename, content)

    // Log activity
    db_helpers.logActivity(
      'agent_file_updated',
      'agent',
      agent.id,
      getUserFromRequest(request)?.username || 'system',
      `${filename} updated for agent ${agent.name}`,
      { filename, content_length: content.length }
    )

    return NextResponse.json({
      success: true,
      message: `${filename} updated for ${agent.name}`,
      filename,
      size: content.length,
    })
  } catch (error: any) {
    if (error.message === 'Path escapes workspace directory') {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }
    console.error('PUT /api/agents/[id]/files/[filename] error:', error)
    return NextResponse.json({ error: 'Failed to write file' }, { status: 500 })
  }
}
