import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createDebate, type DebateRow } from '@/lib/debate-engine'

const createDebateSchema = z.object({
  topic: z.string().min(1).max(1000),
  participantIds: z.array(z.number().int().positive()).min(2).max(20),
  maxRounds: z.number().int().min(1).max(20).default(3),
  tokenBudget: z.number().int().min(100).max(1_000_000).default(10_000),
})

const deleteDebateSchema = z.object({
  id: z.number().int().positive(),
})

/**
 * GET /api/debates - List debates with pagination and optional status filter
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const url = new URL(request.url)

    const status = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)

    let query = 'SELECT * FROM debates WHERE workspace_id = ?'
    const params: (string | number)[] = [workspaceId]

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const debates = db.prepare(query).all(...params) as DebateRow[]

    const totalRow = db.prepare(
      status
        ? 'SELECT COUNT(*) as count FROM debates WHERE workspace_id = ? AND status = ?'
        : 'SELECT COUNT(*) as count FROM debates WHERE workspace_id = ?'
    ).get(...(status ? [workspaceId, status] : [workspaceId])) as { count: number }

    return NextResponse.json({ debates, total: totalRow.count, limit, offset })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/debates error')
    return NextResponse.json({ error: 'Failed to fetch debates' }, { status: 500 })
  }
}

/**
 * POST /api/debates - Create a new debate
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createDebateSchema)
    if ('error' in result) return result.error
    const { topic, participantIds, maxRounds, tokenBudget } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const createdBy = auth.user.username || 'system'

    const { debateId } = createDebate(db, topic, participantIds, maxRounds, tokenBudget, createdBy, workspaceId)

    const debate = db.prepare('SELECT * FROM debates WHERE id = ?').get(debateId) as DebateRow

    return NextResponse.json({ debate }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create debate'
    if (message.includes('not found') || message.includes('requires')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error({ err }, 'POST /api/debates error')
    return NextResponse.json({ error: 'Failed to create debate' }, { status: 500 })
  }
}

/**
 * DELETE /api/debates - Delete a debate (admin only)
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, deleteDebateSchema)
    if ('error' in result) return result.error
    const { id } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const existing = db.prepare('SELECT id FROM debates WHERE id = ? AND workspace_id = ?').get(id, workspaceId)
    if (!existing) {
      return NextResponse.json({ error: 'Debate not found' }, { status: 404 })
    }

    // Delete related records first, then debate
    db.prepare('DELETE FROM debate_votes WHERE debate_id = ?').run(id)
    db.prepare('DELETE FROM debate_arguments WHERE debate_id = ?').run(id)
    db.prepare('DELETE FROM debate_participants WHERE debate_id = ?').run(id)
    db.prepare('DELETE FROM debates WHERE id = ?').run(id)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/debates error')
    return NextResponse.json({ error: 'Failed to delete debate' }, { status: 500 })
  }
}
