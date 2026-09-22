import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { reflectPass, reweavePass, generateMOCs, gapDetectPass, consolidatePass } from '@/lib/memory-utils'
import { consolidateFleet, gapDetectFleet } from '@/lib/memory-fleet-pass'
import { logger } from '@/lib/logger'
import { resolveWorkspaceMemoryAccess } from '@/lib/workspace-isolation'

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

  const memoryAccess = resolveWorkspaceMemoryAccess(auth.user)
  if (!memoryAccess) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'reflect') {
      const result = await reflectPass(memoryAccess.root)
      return NextResponse.json(result)
    }

    if (action === 'reweave') {
      const result = await reweavePass(memoryAccess.root)
      return NextResponse.json(result)
    }

    if (action === 'generate-moc') {
      const mocs = await generateMOCs(memoryAccess.root)
      return NextResponse.json({
        action: 'generate-moc',
        groups: mocs,
        totalGroups: mocs.length,
        totalEntries: mocs.reduce((s, g) => s + g.entries.length, 0),
      })
    }

    if (action === 'gap-detect') {
      const result = memoryAccess.isolation === 'shared'
        ? await gapDetectFleet()
        : await gapDetectPass(memoryAccess.root)
      return NextResponse.json(result)
    }

    if (action === 'consolidate') {
      const result = memoryAccess.isolation === 'shared'
        ? await consolidateFleet()
        : await consolidatePass(memoryAccess.root)
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action. Use: reflect, reweave, generate-moc, gap-detect, consolidate' }, { status: 400 })
  } catch (err) {
    logger.error({ err }, 'Memory process API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
