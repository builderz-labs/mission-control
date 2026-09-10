import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { join } from 'path'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { runHealthDiagnostics } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'
import { resolveWorkspaceMemoryAccess } from '@/lib/workspace-isolation'
import { MEMORY_ALLOWED_PREFIXES } from '@/lib/memory-path'
import { fleetMemoryRoots } from '@/lib/memory-roots'
import { collectFleetWikiStems } from '@/lib/memory-stems'
import { runVaultWikiDoctor } from '@/lib/vault-health'

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

  const memoryAccess = resolveWorkspaceMemoryAccess(auth.user)
  if (!memoryAccess) {
    return NextResponse.json({ error: 'Memory directory not configured' }, { status: 500 })
  }

  try {
    if (memoryAccess.isolation === 'shared') {
      const extraStems = collectFleetWikiStems()
      const reports = []
      for (const root of fleetMemoryRoots()) {
        const folders = root.prefixes.length ? root.prefixes : ['']
        for (const folder of folders) {
          const fullPath = folder ? join(root.root, folder) : root.root
          if (!existsSync(fullPath)) continue
          reports.push(await runHealthDiagnostics(fullPath, { extraStems }))
        }
      }
      const vault = fleetMemoryRoots().find((root) => root.id === 'omnia-vault')
      const merged = reports.length > 0 ? mergeReports(reports) : await runHealthDiagnostics(memoryAccess.root)
      if (vault) {
        const doctor = await runVaultWikiDoctor(vault.root)
        merged.categories.unshift(doctor)
        merged.overallScore = Math.round(
          merged.categories.reduce((sum, category) => sum + category.score, 0) / merged.categories.length,
        )
        merged.overall = merged.overallScore >= 70 ? 'healthy' : merged.overallScore >= 40 ? 'warning' : 'critical'
      }
      return NextResponse.json(merged)
    }
    if (MEMORY_ALLOWED_PREFIXES.length) {
      const reports = []
      for (const prefix of MEMORY_ALLOWED_PREFIXES) {
        const folder = prefix.replace(/\/$/, '')
        const fullPath = join(memoryAccess.root, folder)
        if (!existsSync(fullPath)) continue
        reports.push(await runHealthDiagnostics(fullPath))
      }
      return NextResponse.json(reports.length > 0 ? mergeReports(reports) : await runHealthDiagnostics(memoryAccess.root))
    }

    const report = await runHealthDiagnostics(memoryAccess.root)
    return NextResponse.json(report)
  } catch (err) {
    logger.error({ err }, 'Memory health API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
