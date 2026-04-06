// ---------------------------------------------------------------------------
// Score aggregation and top-level orchestration for the security scan
// ---------------------------------------------------------------------------

import os from 'node:os'
import { type Category, type ScanResult, SEVERITY_WEIGHT } from './types'
import { scanCredentials, scanNetwork, scanOpenClaw, scanRuntime, scanOS } from './scanners'

// ---------------------------------------------------------------------------
// Category scoring helper — pure function, returns new object
// ---------------------------------------------------------------------------

export function scoreCategory(checks: Category['checks']): Category {
  const weightedMax = checks.reduce(
    (s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'],
    0,
  )
  const weightedScore = checks
    .filter(c => c.status === 'pass')
    .reduce((s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'], 0)
  return {
    score: weightedMax > 0 ? Math.round((weightedScore / weightedMax) * 100) : 100,
    checks,
  }
}

// ---------------------------------------------------------------------------
// System uptime — isolated so tests can import it directly
// ---------------------------------------------------------------------------

export function readSystemUptimeSeconds(): number | null {
  try {
    const value = os.uptime()
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator — assembles all category results into a single ScanResult
// ---------------------------------------------------------------------------

export function runSecurityScan(): ScanResult {
  const credentials = scanCredentials()
  const network = scanNetwork()
  const openclaw = scanOpenClaw()
  const runtime = scanRuntime()
  const osLevel = scanOS()

  const categories = { credentials, network, openclaw, runtime, os: osLevel }
  const allChecks = Object.values(categories).flatMap(c => c.checks)

  const weightedMax = allChecks.reduce(
    (s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'],
    0,
  )
  const weightedScore = allChecks
    .filter(c => c.status === 'pass')
    .reduce((s, c) => s + SEVERITY_WEIGHT[c.severity ?? 'medium'], 0)
  const score = weightedMax > 0 ? Math.round((weightedScore / weightedMax) * 100) : 0

  let overall: ScanResult['overall']
  if (score >= 90) overall = 'hardened'
  else if (score >= 70) overall = 'secure'
  else if (score >= 40) overall = 'needs-attention'
  else overall = 'at-risk'

  return { overall, score, timestamp: Date.now(), categories }
}
