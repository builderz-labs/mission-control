/**
 * Atlas state reader — the REAL single source of truth for the fleet.
 *
 * Background (22 Jun 2026): MC was built to read a heartbeat JSON file
 * (`last_heartbeat.json`) and the `approvals` table, but Atlas's daily cron
 * never wrote that file and only writes these tables:
 *   - agent_state    : git drift / commits-ahead / deploy state per agent
 *                      (refreshed every morning at ~05:30 by morning_brief)
 *   - kpi_snapshots  : (snapshot_date, kpi_key, value_num, value_text)
 *   - task_log       : one `morning_brief_built` row per day (freshness probe)
 *   - approvals      : pending approval requests (read via atlas-approvals.ts)
 *
 * So the heartbeat path was dead and MC silently fell back to mock. This module
 * reads what Atlas actually produces. Never throws — returns an `unavailable`
 * marker so callers can render an honest "source offline" state instead of
 * pretending with canned data.
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * Resolve the atlas.db path across environments:
 *   - ATLAS_DB_PATH / ATLAS_APPROVALS_DB_PATH env override (any host)
 *   - /atlas-data/atlas.db        → docker mount on the Hetzner VPS
 *   - ~/atlas/data/atlas.db       → local dev (Gerda's Mac)
 *   - /opt/atlas/data/atlas.db    → bare-metal VPS path
 * Falls back to the docker path if none exist yet (so the error is legible).
 */
export function atlasDbPath(): string {
  const env = process.env.ATLAS_DB_PATH || process.env.ATLAS_APPROVALS_DB_PATH
  if (env) return env
  const candidates = [
    '/atlas-data/atlas.db',
    path.join(os.homedir(), 'atlas', 'data', 'atlas.db'),
    '/opt/atlas/data/atlas.db',
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

function openDb(): Database.Database | null {
  const p = atlasDbPath()
  if (!existsSync(p)) return null
  try {
    return new Database(p, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

/** Hours between an atlas timestamp ("YYYY-MM-DD HH:MM:SS", treated as UTC) and now. */
function ageHours(ts: string | null | undefined): number | null {
  if (!ts) return null
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 3_600_000
}

export function formatAge(ts: string | null | undefined): string {
  const h = ageHours(ts)
  if (h === null) return 'unknown'
  if (h < 1) return `${Math.max(0, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

// ── agent_state ────────────────────────────────────────────────────────────

export interface AgentStateRow {
  agent: string
  drift: boolean
  commits_ahead: number
  session_last_age_hours: number | null
  deploy_state: string | null
  has_vps: boolean
  open_items: string[]
  last_checked_at: string | null
}

export interface AgentStateResult {
  rows: AgentStateRow[]
  source: 'atlas-db' | 'unavailable'
  lastChecked: string | null
  error?: string
}

interface RawAgentState {
  agent: string
  vps_head: string | null
  drift: number
  commits_ahead: number
  session_last_age_hours: number | null
  deploy_state: string | null
  open_items_json: string | null
  last_checked_at: string | null
}

export function readAgentStates(): AgentStateResult {
  const db = openDb()
  if (!db) return { rows: [], source: 'unavailable', lastChecked: null, error: 'db-missing' }
  try {
    const raw = db
      .prepare(
        `SELECT agent, vps_head, drift, commits_ahead, session_last_age_hours,
                deploy_state, open_items_json, last_checked_at
         FROM agent_state
         WHERE agent IS NOT NULL AND agent != ''
         ORDER BY agent ASC`,
      )
      .all() as RawAgentState[]
    let lastChecked: string | null = null
    const rows: AgentStateRow[] = raw.map((r) => {
      if (r.last_checked_at && (!lastChecked || r.last_checked_at > lastChecked)) {
        lastChecked = r.last_checked_at
      }
      let openItems: string[] = []
      try {
        const parsed = JSON.parse(r.open_items_json || '[]')
        if (Array.isArray(parsed)) openItems = parsed.map(String)
      } catch {
        /* noop */
      }
      return {
        agent: r.agent,
        drift: r.drift === 1,
        commits_ahead: r.commits_ahead ?? 0,
        session_last_age_hours: r.session_last_age_hours,
        deploy_state: r.deploy_state || null,
        has_vps: Boolean(r.vps_head),
        open_items: openItems,
        last_checked_at: r.last_checked_at,
      }
    })
    return { rows, source: 'atlas-db', lastChecked }
  } catch (err) {
    return {
      rows: [],
      source: 'unavailable',
      lastChecked: null,
      error: err instanceof Error ? err.message : 'unknown',
    }
  } finally {
    try {
      db.close()
    } catch {
      /* noop */
    }
  }
}

// ── kpi_snapshots ──────────────────────────────────────────────────────────

export interface KpiSnapshot {
  kpi_key: string
  value_num: number | null
  value_text: string | null
  snapshot_date: string
  age_days: number | null
}

export interface KpiResult {
  byKey: Record<string, KpiSnapshot>
  source: 'atlas-db' | 'unavailable'
  error?: string
}

export function readLatestKpis(): KpiResult {
  const db = openDb()
  if (!db) return { byKey: {}, source: 'unavailable', error: 'db-missing' }
  try {
    const rows = db
      .prepare(
        `SELECT k.kpi_key, k.value_num, k.value_text, k.snapshot_date
         FROM kpi_snapshots k
         JOIN (SELECT kpi_key, MAX(snapshot_date) AS md FROM kpi_snapshots GROUP BY kpi_key) m
           ON k.kpi_key = m.kpi_key AND k.snapshot_date = m.md`,
      )
      .all() as Array<Omit<KpiSnapshot, 'age_days'>>
    const byKey: Record<string, KpiSnapshot> = {}
    for (const r of rows) {
      const h = ageHours(r.snapshot_date)
      byKey[r.kpi_key] = { ...r, age_days: h === null ? null : Math.round(h / 24) }
    }
    return { byKey, source: 'atlas-db' }
  } catch (err) {
    return { byKey: {}, source: 'unavailable', error: err instanceof Error ? err.message : 'unknown' }
  } finally {
    try {
      db.close()
    } catch {
      /* noop */
    }
  }
}

// ── freshness probe (task_log morning_brief_built) ───────────────────────────

export interface FleetFreshness {
  dbConnected: boolean
  dbPath: string
  lastBriefAt: string | null
  lastBriefAgeHours: number | null
}

export function readFleetFreshness(): FleetFreshness {
  const dbPath = atlasDbPath()
  const db = openDb()
  if (!db) return { dbConnected: false, dbPath, lastBriefAt: null, lastBriefAgeHours: null }
  try {
    const row = db
      .prepare(
        `SELECT timestamp FROM task_log
         WHERE action = 'morning_brief_built'
         ORDER BY datetime(timestamp) DESC LIMIT 1`,
      )
      .get() as { timestamp: string } | undefined
    const ts = row?.timestamp ?? null
    return { dbConnected: true, dbPath, lastBriefAt: ts, lastBriefAgeHours: ageHours(ts) }
  } catch {
    return { dbConnected: true, dbPath, lastBriefAt: null, lastBriefAgeHours: null }
  } finally {
    try {
      db.close()
    } catch {
      /* noop */
    }
  }
}
