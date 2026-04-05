import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { searchEntities, type SearchEntityType } from '@/lib/search-engine'

export const dynamic = 'force-dynamic'

const ALL_TYPES: SearchEntityType[] = ['agent', 'task', 'memory', 'activity', 'alert']

const EMPTY_RESPONSE = {
  results: [], query: '', totalHits: 0, durationMs: 0, engine: 'keyword' as const,
}

/**
 * GET /api/search?q=<query>&types=agent,task,memory&limit=20
 * Semantic cross-entity search powered by FTS5 (keyword fallback).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''

  // Return empty result instead of error for short queries — keeps UI simple
  if (q.length < 2) return NextResponse.json(EMPTY_RESPONSE)

  const rawTypes = searchParams.get('types')
  const types: SearchEntityType[] = parseTypes(rawTypes)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 50)

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const response = searchEntities(db, q, types, workspaceId, limit)
    return NextResponse.json(response)
  } catch (err) {
    logger.error({ err, q }, 'Search failed')
    return NextResponse.json(
      { error: 'Search unavailable' },
      { status: 500 },
    )
  }
}

/** Parse comma-separated type list; unknown values are silently dropped. */
function parseTypes(raw: string | null): SearchEntityType[] {
  if (!raw) return ALL_TYPES
  const requested = raw.split(',').map(s => s.trim()) as SearchEntityType[]
  const valid = requested.filter(t => ALL_TYPES.includes(t))
  return valid.length > 0 ? valid : ALL_TYPES
}
