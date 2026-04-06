// Performance profiling sub-module.
// Tracks per-operation latency baselines using an incremental (online) mean
// so we never need to store raw samples, and flags regressions when the
// running average drifts more than REGRESSION_THRESHOLD above the baseline.

import { getDatabase } from '../db'
import type { PerformanceBaseline, PerformanceDataPoint } from './types'

// A 20 % drift above the recorded baseline is considered a regression.
const REGRESSION_THRESHOLD = 0.20

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureProfilerTables(): void {
  const db = getDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_name TEXT NOT NULL,
      baseline_ms REAL NOT NULL,
      current_avg_ms REAL,
      sample_count INTEGER DEFAULT 0,
      regression_detected INTEGER DEFAULT 0,
      workspace_id INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_perf_baselines_op ON performance_baselines(operation_name, workspace_id)`)
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function recordPerformanceSample(point: PerformanceDataPoint): PerformanceBaseline {
  const db = getDatabase()
  const workspaceId = point.workspace_id ?? 1

  const existing = db.prepare(
    'SELECT id, operation_name, baseline_ms, current_avg_ms, sample_count, regression_detected, workspace_id, created_at, updated_at FROM performance_baselines WHERE operation_name = ? AND workspace_id = ?'
  ).get(point.operation_name, workspaceId) as PerformanceBaseline | undefined

  if (!existing) {
    return createBaseline(point.operation_name, point.duration_ms, workspaceId)
  }

  return updateBaseline(existing, point.duration_ms)
}

export function getBaselines(workspaceId: number): ReadonlyArray<PerformanceBaseline> {
  const db = getDatabase()
  return db.prepare(
    'SELECT id, operation_name, baseline_ms, current_avg_ms, sample_count, regression_detected, workspace_id, created_at, updated_at FROM performance_baselines WHERE workspace_id = ? ORDER BY operation_name'
  ).all(workspaceId) as PerformanceBaseline[]
}

export function getRegressions(workspaceId: number): ReadonlyArray<PerformanceBaseline> {
  const db = getDatabase()
  return db.prepare(
    'SELECT id, operation_name, baseline_ms, current_avg_ms, sample_count, regression_detected, workspace_id, created_at, updated_at FROM performance_baselines WHERE workspace_id = ? AND regression_detected = 1 ORDER BY updated_at DESC'
  ).all(workspaceId) as PerformanceBaseline[]
}

// ---------------------------------------------------------------------------
// Helpers (not exported — internal implementation detail)
// ---------------------------------------------------------------------------

function createBaseline(
  operationName: string,
  durationMs: number,
  workspaceId: number,
): PerformanceBaseline {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const result = db.prepare(`
    INSERT INTO performance_baselines (operation_name, baseline_ms, current_avg_ms, sample_count, workspace_id, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(operationName, durationMs, durationMs, workspaceId, now, now)

  return {
    id: Number(result.lastInsertRowid),
    operation_name: operationName,
    baseline_ms: durationMs,
    current_avg_ms: durationMs,
    sample_count: 1,
    regression_detected: 0,
    workspace_id: workspaceId,
    created_at: now,
    updated_at: now,
  }
}

function updateBaseline(
  existing: PerformanceBaseline,
  durationMs: number,
): PerformanceBaseline {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const newCount = existing.sample_count + 1
  const prevAvg = existing.current_avg_ms ?? existing.baseline_ms
  // Welford-style incremental mean — no mutation of the input record
  const newAvg = prevAvg + (durationMs - prevAvg) / newCount
  const regressionDetected = newAvg > existing.baseline_ms * (1 + REGRESSION_THRESHOLD) ? 1 : 0

  db.prepare(`
    UPDATE performance_baselines
    SET current_avg_ms = ?, sample_count = ?, regression_detected = ?, updated_at = ?
    WHERE id = ?
  `).run(newAvg, newCount, regressionDetected, now, existing.id)

  return {
    ...existing,
    current_avg_ms: newAvg,
    sample_count: newCount,
    regression_detected: regressionDetected,
    updated_at: now,
  }
}
