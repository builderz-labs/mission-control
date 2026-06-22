/**
 * Atlas approvals reader.
 *
 * Atlas stores approval requests in /opt/atlas/data/atlas.db (table: approvals).
 * Mounted into the MC container read-only at /atlas-data (see docker-compose.yml).
 *
 * Returns [] if the DB file is missing, locked, or the query fails — callers
 * fall back to mock data. Never throws.
 *
 * Schema:
 *   approvals(id, requested_by, agent, action, plan_json, status,
 *             slack_message_ts, approved_at, executed_at, result, created_at)
 *
 * We pull status='pending' only, oldest-first, capped to N rows.
 */

import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { atlasDbPath } from './atlas-state'

export interface AtlasApprovalRow {
  id: number
  requested_by: string
  agent: string
  action: string
  plan_json: string
  status: string
  slack_message_ts: string | null
  created_at: string
}

export interface AtlasApprovalCard {
  id: string                 // "A<id>"
  approval_id: number
  agent: string
  action: string
  title: string              // human-readable, agent + action
  why: string                // compact plan_json summary, max ~80 chars
  cta: string
  deeplink: string
  slack_ts: string | null
  created_at: string
}

const APPROVALS_DB_PATH = atlasDbPath()

const AGENT_LABELS: Record<string, string> = {
  sofia: 'Sofia', james: 'James', leo: 'Leo', victoria: 'Victoria',
  aria: 'Aria', marcus: 'Marcus', atlas: 'Atlas', edward: 'Edward',
  cleo: 'Cleo', iris: 'Iris', larry: 'Larry', nina: 'Nina',
  nathan: 'Nathan', hugo: 'Hugo', owen: 'Owen', mila: 'Mila',
}

function humanizeAction(action: string): string {
  return action.replace(/[_-]+/g, ' ').trim()
}

function capitalize(s: string): string {
  return AGENT_LABELS[s.toLowerCase()] ?? (s.charAt(0).toUpperCase() + s.slice(1))
}

function summarisePlan(planJson: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(planJson) } catch { return '' }
  if (!parsed || typeof parsed !== 'object') return ''
  const obj = parsed as Record<string, unknown>
  // Try common summary-shaped fields in order.
  for (const key of ['summary', 'description', 'subject', 'reason', 'notes', 'target', 'recipient']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim().length > 0) {
      const trimmed = v.trim()
      return trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed
    }
  }
  // Fallback: list top-level keys, helpful for at-a-glance shape.
  const keys = Object.keys(obj).slice(0, 4)
  return keys.length > 0 ? `plan: ${keys.join(', ')}` : ''
}

function toCard(row: AtlasApprovalRow): AtlasApprovalCard {
  const agentLabel = capitalize(row.agent)
  const actionLabel = humanizeAction(row.action)
  const why = summarisePlan(row.plan_json) || `requested by ${row.requested_by}`
  return {
    id: `A${row.id}`,
    approval_id: row.id,
    agent: row.agent,
    action: row.action,
    title: `${agentLabel}: ${actionLabel}`,
    why,
    cta: row.slack_message_ts ? 'Review in Slack' : 'Open approval',
    deeplink: `/decisions?approval=${row.id}`,
    slack_ts: row.slack_message_ts,
    created_at: row.created_at,
  }
}

export interface ReadApprovalsResult {
  cards: AtlasApprovalCard[]
  source: 'atlas-db' | 'unavailable'
  pending_count: number
  error?: string
}

export function readPendingApprovals(limit = 3): ReadApprovalsResult {
  if (!existsSync(APPROVALS_DB_PATH)) {
    return { cards: [], source: 'unavailable', pending_count: 0, error: 'db-missing' }
  }
  let db: Database.Database | null = null
  try {
    db = new Database(APPROVALS_DB_PATH, { readonly: true, fileMustExist: true })
    const total = db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`).get() as { n: number }
    const rows = db.prepare(
      `SELECT id, requested_by, agent, action, plan_json, status, slack_message_ts, created_at
       FROM approvals
       WHERE status = 'pending'
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT ?`
    ).all(limit) as AtlasApprovalRow[]
    return {
      cards: rows.map(toCard),
      source: 'atlas-db',
      pending_count: total?.n ?? rows.length,
    }
  } catch (err) {
    return {
      cards: [],
      source: 'unavailable',
      pending_count: 0,
      error: err instanceof Error ? err.message : 'unknown',
    }
  } finally {
    try { db?.close() } catch { /* noop */ }
  }
}

export function approvalsDbPath(): string {
  return APPROVALS_DB_PATH
}
