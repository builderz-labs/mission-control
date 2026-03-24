import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { reflectPass, reweavePass, generateMOCs, gapDetectPass, consolidatePass } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

const MEMORY_PATH = config.memoryDir

/**
 * Processing pipeline endpoint — runs knowledge maintenance operations.
 * Actions: reflect, reweave, generate-moc
 *
 * These mirror Ars Contexta's 6 Rs processing pipeline, adapted for MC:
 * - reflect: Find connection opportunities between files
 * - reweave: Identify stale files needing updates from newer linked files
 * - generate-moc: Auto-generate Maps of Content from file clusters
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
    const { action } = body

    if (action === 'reflect') {
      const result = await reflectPass(MEMORY_PATH)
      return NextResponse.json(result)
    }

    if (action === 'reweave') {
      const result = await reweavePass(MEMORY_PATH)
      return NextResponse.json(result)
    }

    if (action === 'generate-moc') {
      const mocs = await generateMOCs(MEMORY_PATH)
      return NextResponse.json({
        action: 'generate-moc',
        groups: mocs,
        totalGroups: mocs.length,
        totalEntries: mocs.reduce((s, g) => s + g.entries.length, 0),
      })
    }

    if (action === 'gap-detect') {
      const result = await gapDetectPass(MEMORY_PATH)
      return NextResponse.json(result)
    }

    if (action === 'consolidate') {
      const result = await consolidatePass(MEMORY_PATH)
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action. Use: reflect, reweave, generate-moc, gap-detect, consolidate' }, { status: 400 })
  } catch (err) {
    logger.error({ err }, 'Memory process API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
