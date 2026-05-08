import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

const VOXSIGN_ROOT = process.env.VOXSIGN_ROOT || '/home/ubuntu/projects/voxsign'

async function readJson(relativePath: string) {
  try {
    const content = await readFile(path.join(VOXSIGN_ROOT, relativePath), 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function readText(relativePath: string) {
  try {
    return await readFile(path.join(VOXSIGN_ROOT, relativePath), 'utf8')
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [
      health,
      excellence,
      budgetControl,
      ciBacklog,
      evalCoverage,
      latestHealthReport,
      latestScorecardReport,
      latestEvalCoverageReport,
    ] = await Promise.all([
      readJson('.team/state/ai_team_os_health.json'),
      readJson('.team/state/ai_team_excellence_scorecard.json'),
      readJson('.team/state/ai_team_budget_control.json'),
      readJson('.team/state/ci_pr_backlog.json'),
      readJson('.team/state/ai_team_eval_coverage.json'),
      readText('reports/ops/latest/ai-team-os-health-latest.md'),
      readText('reports/ops/latest/ai-team-excellence-scorecard-latest.md'),
      readText('reports/ops/latest/ai-team-eval-coverage-latest.md'),
    ])

    const missing = [
      ['health', health],
      ['excellence', excellence],
      ['budgetControl', budgetControl],
      ['ciBacklog', ciBacklog],
      ['evalCoverage', evalCoverage],
    ].filter(([, value]) => !value).map(([name]) => name)

    return NextResponse.json({
      root: VOXSIGN_ROOT,
      generatedAt: new Date().toISOString(),
      missing,
      health,
      excellence,
      budgetControl,
      ciBacklog,
      evalCoverage,
      reports: {
        health: latestHealthReport,
        excellence: latestScorecardReport,
        evalCoverage: latestEvalCoverageReport,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'AI Team OS API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
