import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { MEMORY_PATH, MEMORY_ALLOWED_PREFIXES } from '@/lib/memory-path'
import { searchMemory, rebuildIndex } from '@/lib/memory-search'
import { getDatabase } from '@/lib/db'

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

  if (!MEMORY_PATH) {
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
    const response = await searchMemory(MEMORY_PATH, MEMORY_ALLOWED_PREFIXES, query, { limit })
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

  if (!MEMORY_PATH) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  try {
    const body = await request.json()

    if (body.action === 'rebuild') {
      const result = await rebuildIndex(MEMORY_PATH, MEMORY_ALLOWED_PREFIXES)
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
