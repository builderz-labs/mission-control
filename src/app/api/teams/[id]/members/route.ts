import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface MemberRow {
  agent_id: number
  name: string
  role: string | null
  status: string | null
  joined_at: number
}

const addMemberSchema = z.object({
  agent_id: z.number().int().positive(),
})

const removeMemberSchema = z.object({
  agent_id: z.number().int().positive(),
})

/**
 * GET /api/teams/[id]/members - List members (JOIN agents for name/role/status)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const teamId = parseInt(id, 10)
    if (isNaN(teamId)) {
      return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify team exists and belongs to workspace
    const team = db.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(teamId, workspaceId)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const members = db.prepare(`
      SELECT tm.agent_id, a.name, a.role, a.status, tm.joined_at
      FROM team_members tm
      JOIN agents a ON a.id = tm.agent_id
      WHERE tm.team_id = ?
      ORDER BY a.name ASC
    `).all(teamId) as MemberRow[]

    return NextResponse.json({ members })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/teams/[id]/members error')
    return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 })
  }
}

/**
 * POST /api/teams/[id]/members - Add agent to team
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const teamId = parseInt(id, 10)
    if (isNaN(teamId)) {
      return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
    }

    const result = await validateBody(request, addMemberSchema)
    if ('error' in result) return result.error
    const { agent_id } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify team exists and belongs to workspace
    const team = db.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(teamId, workspaceId)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    // Verify agent exists in workspace
    const agent = db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(agent_id, workspaceId) as { id: number; name: string } | undefined
    if (!agent) {
      return NextResponse.json({ error: `Agent ${agent_id} not found` }, { status: 404 })
    }

    db.prepare(`
      INSERT INTO team_members (team_id, agent_id)
      VALUES (?, ?)
    `).run(teamId, agent_id)

    return NextResponse.json({ added: true, agent_id, team_id: teamId }, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'Agent is already a member of this team' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/teams/[id]/members error')
    return NextResponse.json({ error: 'Failed to add team member' }, { status: 500 })
  }
}

/**
 * DELETE /api/teams/[id]/members - Remove agent from team
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const teamId = parseInt(id, 10)
    if (isNaN(teamId)) {
      return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
    }

    const result = await validateBody(request, removeMemberSchema)
    if ('error' in result) return result.error
    const { agent_id } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify team exists and belongs to workspace
    const team = db.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(teamId, workspaceId)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const deleteResult = db.prepare('DELETE FROM team_members WHERE team_id = ? AND agent_id = ?').run(teamId, agent_id)

    if (deleteResult.changes === 0) {
      return NextResponse.json({ error: 'Agent is not a member of this team' }, { status: 404 })
    }

    return NextResponse.json({ removed: true, agent_id, team_id: teamId })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/teams/[id]/members error')
    return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 })
  }
}
