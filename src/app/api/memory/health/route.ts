import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { join } from 'path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { runHealthDiagnostics } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

const MEMORY_PATH = config.memoryDir
const MEMORY_ALLOWED_PREFIXES = (config.memoryAllowedPrefixes || []).map((p) => p.replace(/\\/g, '/'))

function mergeReports(reports: Awaited<ReturnType<typeof runHealthDiagnostics>>[]) {
  const allCategories = reports.flatMap((report) => report.categories)
  const mergedCategories = Array.from(new Set(allCategories.map((category) => category.name))).map((name) => {
    const group = allCategories.filter((category) => category.name === name)
    const score = Math.round(group.reduce((sum, category) => sum + category.score, 0) / group.length)
    const status = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical'
    return {
      name,
      status,
      score,
      issues: group.flatMap((category) => category.issues).slice(0, 10),
      suggestions: Array.from(new Set(group.flatMap((category) => category.suggestions))),
    }
  })

  const overallScore = mergedCategories.length > 0
    ? Math.round(mergedCategories.reduce((sum, category) => sum + category.score, 0) / mergedCategories.length)
    : 100
  const overall = overallScore >= 70 ? 'healthy' : overallScore >= 40 ? 'warning' : 'critical'

  return {
    overall,
    overallScore,
    categories: mergedCategories,
    generatedAt: Date.now(),
  }
}

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
      const reports = []
      for (const prefix of MEMORY_ALLOWED_PREFIXES) {
        const folder = prefix.replace(/\/$/, '')
        const fullPath = join(MEMORY_PATH, folder)
        if (!existsSync(fullPath)) continue
        reports.push(await runHealthDiagnostics(fullPath))
      }
      return NextResponse.json(reports.length > 0 ? mergeReports(reports) : await runHealthDiagnostics(MEMORY_PATH))
    }

    const report = await runHealthDiagnostics(MEMORY_PATH)
    return NextResponse.json(report)
  } catch (err) {
    logger.error({ err }, 'Memory health API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
