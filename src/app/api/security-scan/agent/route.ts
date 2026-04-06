import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { runSecurityScan, FIX_SAFETY, type CheckSeverity, type FixSafety, type Check } from '@/lib/security-scan'

type FixScope = 'safe' | 'safe+restart' | 'all'

interface FixResult {
  id: string
  fixed: boolean
  [key: string]: unknown
}

interface FixResponse {
  fixed: number
  failed: number
  results: FixResult[]
}

interface AgentScanFixRequest {
  action: 'scan' | 'fix' | 'scan-and-fix'
  fixScope?: FixScope
  ids?: string[]
  force?: boolean
  dryRun?: boolean
}

function isFixableInScope(checkId: string, scope: FixScope, force: boolean): boolean {
  const safety = FIX_SAFETY[checkId]
  if (!safety) return false
  if (safety === 'safe') return true
  if (safety === 'requires-restart' && (scope === 'safe+restart' || scope === 'all')) return true
  if (safety === 'requires-review' && scope === 'all' && force) return true
  return false
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: AgentScanFixRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, fixScope = 'safe+restart', ids, force = false, dryRun = false } = body

  if (!action || !['scan', 'fix', 'scan-and-fix'].includes(action)) {
    return NextResponse.json({ error: 'action must be "scan", "fix", or "scan-and-fix"' }, { status: 400 })
  }

  try {
    // Always scan first
    const scanResult = runSecurityScan()
    const allChecks = Object.values(scanResult.categories).flatMap(c => c.checks)
    const failingChecks = allChecks.filter(c => c.status !== 'pass')

    const scanResponse = {
      overall: scanResult.overall,
      score: scanResult.score,
      failingChecks: failingChecks.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        severity: c.severity ?? 'medium' as CheckSeverity,
        detail: c.detail,
        fix: c.fix,
        fixSafety: FIX_SAFETY[c.id] ?? c.fixSafety ?? ('manual-only' as FixSafety),
        autoFixable: isFixableInScope(c.id, fixScope, force),
      })),
      passingCount: allChecks.length - failingChecks.length,
      totalCount: allChecks.length,
      categories: Object.fromEntries(
        Object.entries(scanResult.categories).map(([key, cat]) => [
          key,
          { score: cat.score, failCount: cat.checks.filter(c => c.status !== 'pass').length },
        ])
      ),
    }

    if (action === 'scan') {
      const criticalCount = failingChecks.filter(c => c.severity === 'critical').length
      const highCount = failingChecks.filter(c => c.severity === 'high').length
      return NextResponse.json({
        scan: scanResponse,
        summary: `Security score: ${scanResult.score}/100 (${scanResult.overall}). ${failingChecks.length} issue(s): ${criticalCount} critical, ${highCount} high.`,
      })
    }

    // Fix or scan-and-fix
    const targetIds = ids ? new Set(ids) : null
    const checksToFix = failingChecks.filter(c => {
      if (targetIds && !targetIds.has(c.id)) return false
      return isFixableInScope(c.id, fixScope, force)
    })

    const skipped: Array<{ id: string; reason: string }> = []
    const requiresManual: Array<{ id: string; name: string; instructions: string }> = []

    // Identify skipped and manual checks
    for (const c of failingChecks) {
      if (targetIds && !targetIds.has(c.id)) continue
      const safety = FIX_SAFETY[c.id] ?? c.fixSafety
      if (!safety || safety === 'manual-only') {
        requiresManual.push({ id: c.id, name: c.name, instructions: c.fix })
      } else if (!isFixableInScope(c.id, fixScope, force)) {
        const reason = safety === 'requires-review' && !force
          ? 'requires-review: set force=true to apply'
          : safety === 'requires-restart' && fixScope === 'safe'
            ? 'requires-restart: use fixScope "safe+restart" or "all"'
            : `fix safety level "${safety}" not in scope "${fixScope}"`
        skipped.push({ id: c.id, reason })
      }
    }

    if (dryRun) {
      return NextResponse.json({
        scan: scanResponse,
        fixes: {
          applied: checksToFix.map(c => ({
            id: c.id,
            name: c.name,
            fixed: false,
            detail: `[dry-run] Would apply fix: ${c.fix}`,
            fixSafety: FIX_SAFETY[c.id],
          })),
          skipped,
          requiresRestart: checksToFix.some(c => FIX_SAFETY[c.id] === 'requires-restart'),
          requiresManual,
        },
        summary: `Dry run: ${checksToFix.length} fix(es) would be applied, ${skipped.length} skipped, ${requiresManual.length} require manual action.`,
      })
    }

    // Actually apply fixes by calling the fix endpoint logic
    const fixIds = checksToFix.map(c => c.id)
    let fixResponse: FixResponse = { fixed: 0, failed: 0, results: [] }

    if (fixIds.length > 0) {
      // Import and call the fix route handler internally
      const fixUrl = new URL('/api/security-scan/fix', request.url)
      const fixReq = new NextRequest(fixUrl, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({ ids: fixIds }),
      })

      // Dynamically import to avoid circular deps
      const { POST: fixHandler } = await import('../fix/route')
      const fixRes = await fixHandler(fixReq)
      fixResponse = await fixRes.json()
    }

    const applied = (fixResponse.results || []).map((r: FixResult) => ({
      ...r,
      fixSafety: FIX_SAFETY[r.id],
    }))

    const requiresRestart = applied.some((r: FixResult) => r.fixed && FIX_SAFETY[r.id] === 'requires-restart')

    logger.info({ action, fixScope, force, dryRun, applied: applied.length, skipped: skipped.length }, 'Agent security scan+fix')

    // Re-scan after fixes to get updated score
    const postFixScan = fixIds.length > 0 ? runSecurityScan() : scanResult

    return NextResponse.json({
      scan: {
        ...scanResponse,
        score: postFixScan.score,
        overall: postFixScan.overall,
      },
      fixes: {
        applied,
        skipped,
        requiresRestart,
        requiresManual,
      },
      summary: buildSummary(applied, skipped, requiresManual, requiresRestart, postFixScan.score, postFixScan.overall),
    })
  } catch (error) {
    logger.error({ err: error }, 'Agent security scan error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function buildSummary(
  applied: FixResult[],
  skipped: { id: string }[],
  requiresManual: { id: string }[],
  requiresRestart: boolean,
  score: number,
  overall: string,
): string {
  const parts: string[] = []
  const fixedCount = applied.filter((r: FixResult) => r.fixed).length
  if (fixedCount > 0) parts.push(`${fixedCount} issue(s) fixed`)
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`)
  if (requiresManual.length > 0) parts.push(`${requiresManual.length} require manual action`)
  if (requiresRestart) parts.push('server restart recommended')
  parts.push(`score: ${score}/100 (${overall})`)
  return parts.join('. ') + '.'
}
