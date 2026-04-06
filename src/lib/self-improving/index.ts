// Self-improving engine — public API and singleton orchestrator.
// Composes the three sub-modules (profiler, cost-tracker, quality-scorer)
// behind a single class so callers always work through one entry point.

import { logger } from '../logger'
import {
  ensureProfilerTables,
  recordPerformanceSample,
  getBaselines,
  getRegressions,
} from './profiler'
import {
  ensureCostTrackerTables,
  recordCost,
  getCostByAgent,
  getCostByTaskType,
  compareApproaches,
  analyzeTrend,
} from './cost-tracker'
import {
  ensureQualityScorerTables,
  getQualityScores,
  createSuggestion,
  updateSuggestionStatus,
  getSuggestions,
  generateSuggestions,
} from './quality-scorer'
import type {
  ABTestResult,
  CostDataPoint,
  CostRecord,
  DashboardSummary,
  ImprovementSuggestion,
  PerformanceBaseline,
  PerformanceDataPoint,
  QualitySummary,
  SuggestionStatus,
  TrendWindow,
} from './types'

// Re-export every public type so consumers import from a single path.
export type {
  ABTestResult,
  AgentCostSummary,
  CostDataPoint,
  CostRecord,
  DashboardSummary,
  ImprovementSuggestion,
  PerformanceBaseline,
  PerformanceDataPoint,
  QualitySummary,
  SuggestionCategory,
  SuggestionSeverity,
  SuggestionStatus,
  TaskTypeCostSummary,
  TrendValue,
  TrendWindow,
} from './types'

// Re-export named helper so callers can use it without going through the class.
export { createSuggestion }

// ---------------------------------------------------------------------------
// Engine class
// ---------------------------------------------------------------------------

class SelfImprovingEngine {
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    try {
      ensureProfilerTables()
      ensureCostTrackerTables()
      ensureQualityScorerTables()
      this.initialized = true
      logger.info('Self-improving engine initialized')
    } catch (err) {
      logger.error({ err }, 'Failed to initialize self-improving engine')
    }
  }

  recordPerformance(point: PerformanceDataPoint): PerformanceBaseline {
    this.ensureReady()
    return recordPerformanceSample(point)
  }

  recordCost(point: CostDataPoint): CostRecord {
    this.ensureReady()
    return recordCost(point)
  }

  updateSuggestionStatus(
    id: number,
    status: SuggestionStatus,
    workspaceId: number,
  ): ImprovementSuggestion | null {
    this.ensureReady()
    return updateSuggestionStatus(id, status, workspaceId)
  }

  generateSuggestions(workspaceId: number): ReadonlyArray<ImprovementSuggestion> {
    this.ensureReady()
    const suggestions = generateSuggestions(workspaceId)
    logger.info(
      { workspaceId, count: suggestions.length },
      'Self-improving cycle: suggestions generated'
    )
    return suggestions
  }

  compareApproaches(taskType: string, workspaceId: number): ReadonlyArray<ABTestResult> {
    this.ensureReady()
    return compareApproaches(taskType, workspaceId)
  }

  analyzeTrend(
    metric: 'cost' | 'performance' | 'quality',
    period: 'daily' | 'weekly' | 'monthly',
    workspaceId: number,
  ): TrendWindow {
    this.ensureReady()
    return analyzeTrend(metric, period, workspaceId)
  }

  getDashboard(workspaceId: number): DashboardSummary {
    this.ensureReady()
    return {
      baselines: getBaselines(workspaceId),
      regressions: getRegressions(workspaceId),
      cost_by_agent: getCostByAgent(workspaceId),
      cost_by_task_type: getCostByTaskType(workspaceId),
      quality_scores: getQualityScores(workspaceId),
      suggestions: getSuggestions(workspaceId, 'pending'),
      trends: {
        cost: analyzeTrend('cost', 'weekly', workspaceId),
        performance: analyzeTrend('performance', 'weekly', workspaceId),
        quality: analyzeTrend('quality', 'weekly', workspaceId),
      },
    }
  }

  getBaselines(workspaceId: number): ReadonlyArray<PerformanceBaseline> {
    this.ensureReady()
    return getBaselines(workspaceId)
  }

  getSuggestions(
    workspaceId: number,
    status?: SuggestionStatus,
  ): ReadonlyArray<ImprovementSuggestion> {
    this.ensureReady()
    return getSuggestions(workspaceId, status)
  }

  getQualityScores(workspaceId: number): ReadonlyArray<QualitySummary> {
    this.ensureReady()
    return getQualityScores(workspaceId)
  }

  getCostByAgent(workspaceId: number): ReturnType<typeof getCostByAgent> {
    this.ensureReady()
    return getCostByAgent(workspaceId)
  }

  private ensureReady(): void {
    if (!this.initialized) {
      this.initialize()
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — HMR-safe via globalThis to survive Next.js module reloads
// ---------------------------------------------------------------------------

const globalEngine = globalThis as typeof globalThis & { __selfImprovingEngine?: SelfImprovingEngine }
export const selfImprovingEngine = globalEngine.__selfImprovingEngine ?? new SelfImprovingEngine()
globalEngine.__selfImprovingEngine = selfImprovingEngine
