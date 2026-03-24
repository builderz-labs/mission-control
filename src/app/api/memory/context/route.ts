import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { join } from 'path'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { generateContextPayload, ContextPayload } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'
import { MEMORY_PATH, MEMORY_ALLOWED_PREFIXES } from '@/lib/memory-path'

function mergeContextPayloads(payloads: ContextPayload[]): ContextPayload {
  return {
    fileTree: payloads.flatMap((p) => p.fileTree),
    recentFiles: payloads
      .flatMap((p) => p.recentFiles)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 10),
    healthSummary: {
      overall: payloads.some((p) => p.healthSummary.overall === 'critical')
        ? 'critical'
        : payloads.some((p) => p.healthSummary.overall === 'warning')
          ? 'warning'
          : 'healthy',
      score: payloads.length > 0
        ? Math.round(payloads.reduce((s, p) => s + p.healthSummary.score, 0) / payloads.length)
        : 100,
    },
    maintenanceSignals: payloads.flatMap((p) => p.maintenanceSignals),
  }
}

/**
 * Context injection endpoint — generates a payload for agent session start.
 * Returns workspace tree, recent files, health summary, and maintenance signals.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  if (!MEMORY_PATH) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  try {
    if (MEMORY_ALLOWED_PREFIXES.length) {
      const payloads: ContextPayload[] = []
      for (const prefix of MEMORY_ALLOWED_PREFIXES) {
        const folder = prefix.replace(/\/$/, '')
        const fullPath = join(MEMORY_PATH, folder)
        if (!existsSync(fullPath)) continue
        payloads.push(await generateContextPayload(fullPath))
      }
      return NextResponse.json(
        payloads.length > 0
          ? mergeContextPayloads(payloads)
          : await generateContextPayload(MEMORY_PATH)
      )
    }

    const payload = await generateContextPayload(MEMORY_PATH)
    return NextResponse.json(payload)
  } catch (err) {
    logger.error({ err }, 'Memory context API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
