import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { resolveWithin } from '@/lib/paths'
import { getAgentWorkspaceCandidates, readAgentWorkspaceFile } from '@/lib/agent-workspace'
import { logger } from '@/lib/logger'

const ALLOWED_FILES = new Set([
  'agent.md',
  'identity.md',
  'soul.md',
  'WORKING.md',
  'MEMORY.md',
  'TOOLS.md',
  'AGENTS.md',
  'MISSION.md',
  'USER.md',
])
const FILE_ALIASES: Record<string, string[]> = {
  'agent.md': ['agent.md', 'AGENT.md', 'MISSION.md', 'USER.md'],
  'identity.md': ['identity.md', 'IDENTITY.md'],
  'soul.md': ['soul.md', 'SOUL.md'],
  'WORKING.md': ['WORKING.md', 'working.md'],
  'MEMORY.md': ['MEMORY.md', 'memory.md'],
  'TOOLS.md': ['TOOLS.md', 'tools.md'],
  'AGENTS.md': ['AGENTS.md', 'agents.md'],
  'MISSION.md': ['MISSION.md', 'mission.md'],
  'USER.md': ['USER.md', 'user.md'],
}

function resolveAgentWorkspacePath(workspace: string): string {
  if (isAbsolute(workspace)) return resolve(workspace)
  if (!config.openclawStateDir) throw new Error('OPENCLAW_STATE_DIR not configured')
  return resolveWithin(config.openclawStateDir, workspace)
}

function getAgentByIdOrName(db: ReturnType<typeof getDatabase>, id: string, workspaceId: number): any | undefined {
  if (isNaN(Number(id))) {
    return db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId)
  }
  return db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const agent = getAgentByIdOrName(db, id, workspaceId)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const agentConfig = agent.config ? JSON.parse(agent.config) : {}
    const candidates = getAgentWorkspaceCandidates(agentConfig, agent.name)
    if (candidates.length === 0) {
      return NextResponse.json({ error: 'Agent workspace is not configured' }, { status: 400 })
    }
    const safeWorkspace = candidates[0]
    const requested = (new URL(request.url).searchParams.get('file') || '').trim()
    const files = requested
      ? [requested]
      : ['agent.md', 'identity.md', 'soul.md', 'WORKING.md', 'MEMORY.md', 'TOOLS.md', 'AGENTS.md', 'MISSION.md', 'USER.md']

    const payload: Record<string, { exists: boolean; content: string }> = {}
    for (const file of files) {
      if (!ALLOWED_FILES.has(file)) {
        return NextResponse.json({ error: `Unsupported file: ${file}` }, { status: 400 })
      }
      const aliases = FILE_ALIASES[file] || [file]
      const match = readAgentWorkspaceFile(candidates, aliases)
      payload[file] = { exists: match.exists, content: match.content }
    }

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      workspace: safeWorkspace,
      files: payload,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/files error')
    return NextResponse.json({ error: 'Failed to load workspace files' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const body = await request.json()
    const file = String(body?.file || '').trim()
    const content = String(body?.content || '')
    const MAX_WORKSPACE_FILE_SIZE = 1024 * 1024 // 1 MB
    if (content.length > MAX_WORKSPACE_FILE_SIZE) {
      return NextResponse.json({ error: `File content too large (max ${MAX_WORKSPACE_FILE_SIZE} bytes)` }, { status: 413 })
    }
    if (!ALLOWED_FILES.has(file)) {
      return NextResponse.json({ error: `Unsupported file: ${file}` }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const agent = getAgentByIdOrName(db, id, workspaceId)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const agentConfig = agent.config ? JSON.parse(agent.config) : {}
    const candidates = getAgentWorkspaceCandidates(agentConfig, agent.name)
    const safeWorkspace = candidates[0]
    if (!safeWorkspace) {
      return NextResponse.json({ error: 'Agent workspace is not configured' }, { status: 400 })
    }

    const safePath = resolveWithin(safeWorkspace, file)
    mkdirSync(dirname(safePath), { recursive: true })
    writeFileSync(safePath, content, 'utf-8')

    if (file === 'soul.md') {
      db.prepare('UPDATE agents SET soul_content = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
        .run(content, agent.id, workspaceId)
    }
    if (file === 'WORKING.md') {
      db.prepare('UPDATE agents SET working_memory = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
        .run(content, agent.id, workspaceId)
    }

    db_helpers.logActivity(
      'agent_workspace_file_updated',
      'agent',
      agent.id,
      auth.user.username,
      `${file} updated for ${agent.name}`,
      { file, size: content.length },
      workspaceId
    )

    return NextResponse.json({ success: true, file, size: content.length })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents/[id]/files error')
    return NextResponse.json({ error: 'Failed to save workspace file' }, { status: 500 })
  }
}
