import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { MEMORY_ALLOWED_PREFIXES } from '@/lib/memory-path'
import { searchMemory } from '@/lib/memory-search'
import { rebuildFleetMemoryIndex, searchFleetMemory } from '@/lib/fleet-memory-search'
import { resolveWorkspaceMemoryAccess } from '@/lib/workspace-isolation'

/**
 * GET /api/memory/search?q=query&limit=20
 *
 * FTS5-powered full-text search across memory files.
 * Returns BM25-ranked results with highlighted snippets.
 * Supports FTS5 query syntax: AND, OR, NOT, NEAR, "exact phrase", prefix*
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  const memoryAccess = resolveWorkspaceMemoryAccess(auth.user)
  if (!memoryAccess) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || searchParams.get('query')
  const limitParam = Number(searchParams.get('limit') || '20')
  const limit = Math.min(Math.max(1, limitParam), 100)

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 })
  }

  try {
    const response = await searchFleetMemory(query, limit)
    if (response.results.length === 0) {
      const fallback = await searchMemory(memoryAccess.root, MEMORY_ALLOWED_PREFIXES, query, {
        limit,
        scope: memoryAccess.scope,
      })
      return NextResponse.json(fallback)
    }
    return NextResponse.json(response)
  } catch (err) {
    logger.error({ err }, 'Memory search API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/memory/search { action: "rebuild" }
 *
 * Rebuild the FTS5 index from all memory files.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const memoryAccess = resolveWorkspaceMemoryAccess(auth.user)
  if (!memoryAccess) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  try {
    const body = await request.json()

    if (body.action === 'rebuild') {
      const result = await rebuildFleetMemoryIndex()
      return NextResponse.json({
        success: true,
        message: `Rebuilt FTS index: ${result.indexed} files in ${result.duration}ms`,
        ...result,
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: rebuild' }, { status: 400 })
  } catch (err) {
    logger.error({ err }, 'Memory search POST API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
