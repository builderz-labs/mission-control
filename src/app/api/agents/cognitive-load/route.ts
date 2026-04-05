import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ALL_ULTRON_AGENTS } from '@/lib/ultron-agents'
import { fetchAllAgentMetrics, computeCognitiveLoad } from '@/lib/cognitive-load'
import type { CognitiveLoadScore } from '@/lib/cognitive-load'

export interface CognitiveLoadAgent {
  readonly id: string           // Ultron agent definition id
  readonly dbId: number         // DB primary key
  readonly name: string
  readonly role: string
  readonly department: string
  readonly color: string
  readonly parentId: string | null
  readonly tier: 1 | 2 | 3
  readonly load: CognitiveLoadScore
}

export interface CognitiveLoadResponse {
  readonly agents: CognitiveLoadAgent[]
}

/**
 * GET /api/agents/cognitive-load
 *
 * Returns composite cognitive-load scores for all agents.
 * Auth: viewer role minimum.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const rawMetrics = fetchAllAgentMetrics(db, workspaceId)

    // Build a lookup from agent DB name → raw metrics
    const metricsByName = new Map(rawMetrics.map(m => [m.agentName.toLowerCase(), m]))

    // Build response by joining Ultron agent definitions with DB metrics
    const agents: CognitiveLoadAgent[] = ALL_ULTRON_AGENTS.map((def) => {
      const metrics = metricsByName.get(def.name.toLowerCase())

      const load = computeCognitiveLoad({
        activeTasks:     metrics?.activeTasks     ?? 0,
        pendingTasks:    metrics?.pendingTasks     ?? 0,
        errorCount:      metrics?.errorCount       ?? 0,
        totalActivities: metrics?.totalActivities  ?? 0,
        recentTokens:    metrics?.recentTokens     ?? 0,
        lastSeen:        metrics?.lastSeen         ?? null,
      })

      return {
        id:         def.id,
        dbId:       metrics?.agentId ?? 0,
        name:       def.name,
        role:       def.role,
        department: def.department,
        color:      def.color,
        parentId:   def.parentId,
        tier:       def.tier,
        load,
      }
    })

    return NextResponse.json({ agents } satisfies CognitiveLoadResponse)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/cognitive-load error')
    return NextResponse.json({ error: 'Failed to fetch cognitive load data' }, { status: 500 })
  }
}
