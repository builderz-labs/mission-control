import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import {
  analyzeTokenEfficiency,
  analyzeToolPatterns,
  getFleetBenchmarks,
  generateRecommendations,
} from '@/lib/agent-optimizer'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const agent = searchParams.get('agent')
    const hours = parseInt(searchParams.get('hours') || '24', 10)
    const workspaceId = auth.user.workspace_id ?? 1

    if (!agent) {
      return NextResponse.json({ error: 'Missing required parameter: agent' }, { status: 400 })
    }

    const efficiency = analyzeTokenEfficiency(agent, hours, workspaceId)
    const toolPatterns = analyzeToolPatterns(agent, hours, workspaceId)
    const fleet = getFleetBenchmarks(workspaceId)
    const recommendations = generateRecommendations(agent, workspaceId)

    // Calculate fleet percentile for tokens per session
    const fleetTokens = fleet.reduce<number[]>((acc, f) => {
      if (f.tokensPerTask > 0) acc.push(f.tokensPerTask)
      return acc
    }, []).sort((a, b) => a - b)
    const agentTokensPerTask = efficiency.sessionsCount > 0 ? efficiency.avgTokensPerSession : 0
    const percentile = fleetTokens.length > 0
      ? Math.round((fleetTokens.filter(t => t >= agentTokensPerTask).length / fleetTokens.length) * 100)
      : 50

    // Fleet average cost
    const fleetAvgCost = fleet.length > 0
      ? fleet.reduce((sum, f) => sum + f.costPerTask, 0) / fleet.length
      : 0

    // Tool analysis
    const mostUsed = toolPatterns.topTools.slice(0, 5)
    const leastEffective = toolPatterns.topTools
      .filter(t => t.successRate < 80)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, 5)

    // Performance from fleet benchmarks
    const agentBenchmark = fleet.find(f => f.agentName === agent)

    return NextResponse.json({
      agent,
      analyzedAt: new Date().toISOString(),
      efficiency: {
        tokensPerTask: agentTokensPerTask,
        fleetAverage: fleetTokens.length > 0
          ? Math.round(fleetTokens.reduce((a, b) => a + b, 0) / fleetTokens.length)
          : 0,
        percentile,
        trend: efficiency.totalTokens,
        costPerTask: efficiency.avgCostPerSession,
      },
      toolPatterns: {
        mostUsed: mostUsed.map(t => ({
          name: t.toolName,
          count: t.count,
          successRate: t.successRate,
        })),
        leastEffective: leastEffective.map(t => ({
          name: t.toolName,
          count: t.count,
          successRate: t.successRate,
        })),
        unusedCapabilities: [],
      },
      performance: {
        taskCompletionRate: agentBenchmark?.tasksCompleted ?? 0,
        avgTaskDuration: toolPatterns.avgDurationMs,
        errorRate: toolPatterns.failureRate,
        fleetRanking: fleet.findIndex(f => f.agentName === agent) + 1 || fleet.length + 1,
      },
      recommendations: recommendations.map(r => ({
        category: r.category,
        priority: r.severity,
        title: r.category.charAt(0).toUpperCase() + r.category.slice(1) + ' issue',
        description: r.message,
        expectedImpact: r.metric ?? null,
      })),
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/optimize error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
