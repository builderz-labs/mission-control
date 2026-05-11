/**
 * Resolver Quarterly (Monthly) Benchmark Ingest
 *
 * Scans ~/.openclaw/workspace/resolver-v2/metrics/*.json files produced by the
 * Monthly Resolver Benchmark cron and upserts rows into resolver_quarterly_metrics.
 *
 * Also detects "incumbent upsets": if the newly recommended production model
 * differs from the current active model in resolver_production_model_history,
 * it inserts an audit row.
 *
 * File naming convention: YYYY-MM-DD-<model-slug>-run<N>.json
 * We group files by run_date to identify the winning model per run.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getDatabase } from '@/lib/db'
import { getOpenclawWorkspaceDir } from './workspace-paths'
import { logger } from '@/lib/logger'
import { ensureResolverTables } from './telemetry'

export type BenchmarkFileRecord = {
  run_date: string
  model_id: string
  must_include_recall: number | null
  f1_score: number | null
  latency_p50_ms: number | null
  latency_p95_ms: number | null
  cost_per_1k_calls_usd: number | null
  rank_in_run: number
  is_recommended_production: boolean
  notes: string | null
  source_file: string
}

export type QuarterlyIngestResult = {
  runsIngested: number
  modelsIngested: number
  incumbentUpsets: number
  errors: number
}

export function resolveMetricsDir(): string {
  if (process.env.MC_RESOLVER_METRICS_DIR) return process.env.MC_RESOLVER_METRICS_DIR
  const workspaceDir = getOpenclawWorkspaceDir()
  if (workspaceDir) {
    return path.join(workspaceDir, 'resolver-v2', 'metrics')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function extractRunDateFromFilename(filename: string): string | null {
  const m = path.basename(filename).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export function extractModelFromFilename(filename: string): string | null {
  const base = path.basename(filename, '.json')
  const withoutDate = base.replace(/^\d{4}-\d{2}-\d{2}-?/, '')
  const withoutRun = withoutDate.replace(/-run\d+$/, '')
  return withoutRun || null
}

export function parseBenchmarkFile(filePath: string): {
  model: string
  runDate: string
  mustIncludeAccuracy: number
  avgRecall: number
  avgPrecision: number
  latencyP50: number
  latencyP95: number
  costUsd: number
  totalCases: number
  errors: number
} | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof data.must_include_accuracy !== 'number' && typeof data.avg_recall !== 'number') {
    return null
  }

  const runDateFromFile = extractRunDateFromFilename(filePath)
  const runDateFromTs = typeof data.timestamp === 'string'
    ? (data.timestamp as string).slice(0, 10)
    : null
  const runDate = runDateFromFile ?? runDateFromTs
  if (!runDate) return null

  const modelFromFile = extractModelFromFilename(filePath)
  const modelFromData = typeof data.model === 'string' ? (data.model as string) : null
  const model = modelFromData ?? modelFromFile
  if (!model) return null

  const usage = (data.usage && typeof data.usage === 'object' ? data.usage : {}) as Record<string, unknown>
  const costUsd = typeof usage.cost_usd === 'number' ? usage.cost_usd : 0

  return {
    model,
    runDate,
    mustIncludeAccuracy: typeof data.must_include_accuracy === 'number' ? data.must_include_accuracy : 0,
    avgRecall: typeof data.avg_recall === 'number' ? data.avg_recall : 0,
    avgPrecision: typeof data.avg_precision === 'number' ? data.avg_precision : 0,
    latencyP50: typeof data.latency_p50 === 'number' ? data.latency_p50 : 0,
    latencyP95: typeof data.latency_p95 === 'number' ? data.latency_p95 : 0,
    costUsd,
    totalCases: typeof data.total_cases === 'number' ? data.total_cases : 0,
    errors: typeof data.errors === 'number' ? data.errors : 0,
  }
}

export function computeF1(recall: number, precision: number): number | null {
  if (recall + precision === 0) return null
  return (2 * recall * precision) / (recall + precision)
}

export function rankModels(
  models: Array<{ model: string; mustIncludeAccuracy: number; avgRecall: number }>,
): Map<string, number> {
  const sorted = [...models].sort(
    (a, b) => b.mustIncludeAccuracy - a.mustIncludeAccuracy || b.avgRecall - a.avgRecall,
  )
  return new Map(sorted.map((m, i) => [m.model, i + 1]))
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getCurrentProductionModel(db: ReturnType<typeof getDatabase>): string | null {
  const row = db
    .prepare(
      `SELECT model_id FROM resolver_production_model_history
       WHERE effective_to IS NULL
       ORDER BY effective_from DESC
       LIMIT 1`,
    )
    .get() as { model_id: string } | undefined
  return row?.model_id ?? null
}

function recordProductionModelChange(
  db: ReturnType<typeof getDatabase>,
  opts: {
    newModel: string
    runDate: string
    reason: string
    sourceFile: string | null
  },
): void {
  db.prepare(
    `UPDATE resolver_production_model_history
     SET effective_to = ?
     WHERE effective_to IS NULL`,
  ).run(opts.runDate)

  db.prepare(
    `INSERT INTO resolver_production_model_history
       (effective_from, effective_to, model_id, reason, source_file)
     VALUES (?, NULL, ?, ?, ?)`,
  ).run(opts.runDate, opts.newModel, opts.reason, opts.sourceFile)
}

// ---------------------------------------------------------------------------
// Core ingest
// ---------------------------------------------------------------------------

export function ingestQuarterlyResolverMetrics(options?: {
  db?: ReturnType<typeof getDatabase>
  metricsDir?: string
}): QuarterlyIngestResult {
  const result: QuarterlyIngestResult = { runsIngested: 0, modelsIngested: 0, incumbentUpsets: 0, errors: 0 }

  const metricsDir = options?.metricsDir ?? resolveMetricsDir()
  if (!metricsDir) {
    logger.warn('resolver-quarterly-ingest: no metrics dir configured')
    return result
  }

  let files: string[]
  try {
    if (!fs.existsSync(metricsDir)) {
      logger.info('resolver-quarterly-ingest: metrics dir does not exist yet (first benchmark run is 2026-05-01)')
      return result
    }
    files = fs.readdirSync(metricsDir)
      .filter(f => f.endsWith('.json') && /^\d{4}-\d{2}-\d{2}/.test(f))
      .map(f => path.join(metricsDir, f))
      .sort()
  } catch (err: any) {
    logger.error({ err }, 'resolver-quarterly-ingest: cannot read metrics dir')
    return result
  }

  if (files.length === 0) {
    logger.info('resolver-quarterly-ingest: no benchmark files found (first run produces output 2026-05-01)')
    return result
  }

  const db = options?.db ?? getDatabase()
  ensureResolverTables(db)

  const byRunDate = new Map<string, Array<{ filePath: string; parsed: NonNullable<ReturnType<typeof parseBenchmarkFile>> }>>()

  for (const filePath of files) {
    try {
      const parsed = parseBenchmarkFile(filePath)
      if (!parsed) continue
      const group = byRunDate.get(parsed.runDate) ?? []
      group.push({ filePath, parsed })
      byRunDate.set(parsed.runDate, group)
    } catch (err: any) {
      logger.error({ err, filePath }, 'resolver-quarterly-ingest: parse error')
      result.errors++
    }
  }

  if (byRunDate.size === 0) {
    logger.info('resolver-quarterly-ingest: no parseable benchmark files found')
    return result
  }

  const upsert = db.prepare(`
    INSERT INTO resolver_quarterly_metrics
      (run_date, model_id, must_include_recall, f1_score,
       latency_p50_ms, latency_p95_ms, cost_per_1k_calls_usd,
       rank_in_run, is_recommended_production, notes, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_date, model_id) DO UPDATE SET
      must_include_recall = excluded.must_include_recall,
      f1_score = excluded.f1_score,
      latency_p50_ms = excluded.latency_p50_ms,
      latency_p95_ms = excluded.latency_p95_ms,
      cost_per_1k_calls_usd = excluded.cost_per_1k_calls_usd,
      rank_in_run = excluded.rank_in_run,
      is_recommended_production = excluded.is_recommended_production,
      notes = excluded.notes,
      source_file = excluded.source_file
  `)

  for (const [runDate, entries] of [...byRunDate.entries()].sort()) {
    try {
      const byModel = new Map<string, typeof entries>()
      for (const entry of entries) {
        const group = byModel.get(entry.parsed.model) ?? []
        group.push(entry)
        byModel.set(entry.parsed.model, group)
      }

      const modelAverages = [...byModel.entries()].map(([model, runs]) => {
        const avg = (getter: (p: typeof runs[0]['parsed']) => number) =>
          runs.reduce((s, r) => s + getter(r.parsed), 0) / runs.length

        const mustIncludeAccuracy = avg(p => p.mustIncludeAccuracy)
        const avgRecall = avg(p => p.avgRecall)
        const avgPrecision = avg(p => p.avgPrecision)

        return {
          model,
          runDate,
          mustIncludeAccuracy,
          avgRecall,
          avgPrecision,
          latencyP50: avg(p => p.latencyP50),
          latencyP95: avg(p => p.latencyP95),
          costPer1k: avg(p => {
            return p.totalCases > 0 ? p.costUsd / p.totalCases * 1000 : 0
          }),
          f1: computeF1(avgRecall, avgPrecision),
          sourceFile: runs[0].filePath,
        }
      })

      const ranks = rankModels(modelAverages.map(m => ({
        model: m.model,
        mustIncludeAccuracy: m.mustIncludeAccuracy,
        avgRecall: m.avgRecall,
      })))

      const recommendedModel = [...ranks.entries()].find(([, rank]) => rank === 1)?.[0] ?? null

      const currentIncumbent = getCurrentProductionModel(db)
      if (recommendedModel && recommendedModel !== currentIncumbent) {
        const reason = currentIncumbent ? 'benchmark_upset' : 'initial'
        recordProductionModelChange(db, {
          newModel: recommendedModel,
          runDate,
          reason,
          sourceFile: modelAverages.find(m => m.model === recommendedModel)?.sourceFile ?? null,
        })
        result.incumbentUpsets++
        logger.info(
          { runDate, prev: currentIncumbent, next: recommendedModel, reason },
          'resolver-quarterly-ingest: production model changed',
        )
      }

      for (const m of modelAverages) {
        const rank = ranks.get(m.model) ?? modelAverages.length
        upsert.run(
          m.runDate,
          m.model,
          m.mustIncludeAccuracy,
          m.f1,
          m.latencyP50,
          m.latencyP95,
          m.costPer1k,
          rank,
          m.model === recommendedModel ? 1 : 0,
          null,
          m.sourceFile,
        )
        result.modelsIngested++
      }

      result.runsIngested++
    } catch (err: any) {
      logger.error({ err, runDate }, 'resolver-quarterly-ingest: error processing run')
      result.errors++
    }
  }

  return result
}
