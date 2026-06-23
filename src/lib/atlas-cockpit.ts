/**
 * Atlas cockpit reader.
 *
 * Atlas writes /opt/atlas/data/mc_cockpit.json with the live "agent cockpit"
 * export (timeline swimlanes, agent hand-off feed, per-agent connectors, and
 * conversation costs). Mounted into the MC container read-only at /atlas-data
 * (see docker-compose.yml). This module is the single reader.
 *
 * The Atlas exporter is being built in parallel, so the file may not exist yet.
 * This reader returns a graceful EMPTY payload (never throws, never fabricates)
 * when the mount/file is missing or the JSON is invalid — same "no silent mock"
 * discipline as /api/epl/agents: empty state with an honest `source` flag, not
 * canned data dressed up as live.
 *
 * No caching needed: file rewrites periodically, fs read is sub-ms.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export type CockpitStatus = 'shipped' | 'building' | 'blocked' | 'planned'

export interface CockpitTimelineItem {
  title: string
  status: CockpitStatus
  start_week: number
  end_week: number
}

export interface CockpitTimelineLane {
  agent: string
  items: CockpitTimelineItem[]
}

export interface CockpitFeedEntry {
  ts: string
  from: string
  to: string
  summary: string
  kind: string
  cost_usd: number
}

export interface CockpitConnector {
  name: string
  status: string
}

export interface CockpitToolsEntry {
  agent: string
  connectors: CockpitConnector[]
}

export interface CockpitConversation {
  id: string
  agent: string
  cost_usd: number
  turns: number
  last_ts: string
  title: string
  /**
   * Phase-2 chat fields (optional — only present for threaded chat dispatches).
   * `status` tracks the turn lifecycle; `reply` is the latest agent turn text;
   * `awaiting_approval` flags a turn that triggered an action and dropped into
   * the approvals inbox. Read-only Q&A threads need none of these.
   */
  status?: string
  reply?: string
  awaiting_approval?: boolean
}

/**
 * Phase-2 approvals inbox row. Atlas exports its pending-approval store (the
 * same one the Slack gate reads) into the cockpit JSON so MC can render + resolve
 * gated dispatch runs. `id` is the Atlas-side run/approval id used by
 * POST /dispatch/approve. All fields are advisory display data.
 */
export interface CockpitPendingApproval {
  id: string
  agent: string
  kind: string
  summary: string
  requested_at: string
  cost_cap_usd: number
  impact: string
  reversible: boolean
}

export interface CockpitExport {
  generated_at: string
  week_now: number
  timeline: CockpitTimelineLane[]
  agent_feed: CockpitFeedEntry[]
  tools: CockpitToolsEntry[]
  conversations: CockpitConversation[]
  pending_approvals: CockpitPendingApproval[]
}

export interface CockpitPayload extends CockpitExport {
  /** 'live' = read from the Atlas export; 'empty' = mount/file absent or invalid. */
  source: 'live' | 'empty'
}

const DEFAULT_COCKPIT_PATH = '/atlas-data/mc_cockpit.json'

/** Resolved at call time so the path can be overridden per-request/test via env. */
function cockpitFilePath(): string {
  return process.env.ATLAS_COCKPIT_PATH || DEFAULT_COCKPIT_PATH
}

/** The honest empty payload returned when the export is unavailable. */
export function emptyCockpit(): CockpitPayload {
  return {
    generated_at: new Date().toISOString(),
    week_now: isoWeekNow(),
    timeline: [],
    agent_feed: [],
    tools: [],
    conversations: [],
    pending_approvals: [],
    source: 'empty',
  }
}

/** ISO-8601 week number for "now" — used as a sane default when no export. */
export function isoWeekNow(d: Date = new Date()): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function normStatus(v: unknown): CockpitStatus {
  return v === 'shipped' || v === 'building' || v === 'blocked' || v === 'planned'
    ? v
    : 'planned'
}

/**
 * Coerce a raw parsed object into a clean CockpitExport, dropping malformed
 * rows rather than throwing. A partially-bad export degrades gracefully.
 */
function coerce(raw: Record<string, unknown>): CockpitExport {
  const timeline: CockpitTimelineLane[] = Array.isArray(raw.timeline)
    ? raw.timeline
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => ({
          agent: asStr(l.agent),
          items: Array.isArray(l.items)
            ? l.items
                .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
                .map((i) => ({
                  title: asStr(i.title),
                  status: normStatus(i.status),
                  start_week: asNum(i.start_week),
                  end_week: asNum(i.end_week),
                }))
            : [],
        }))
        .filter((l) => l.agent)
    : []

  const agent_feed: CockpitFeedEntry[] = Array.isArray(raw.agent_feed)
    ? raw.agent_feed
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({
          ts: asStr(e.ts),
          from: asStr(e.from),
          to: asStr(e.to),
          summary: asStr(e.summary),
          kind: asStr(e.kind, 'handoff'),
          cost_usd: asNum(e.cost_usd),
        }))
    : []

  const tools: CockpitToolsEntry[] = Array.isArray(raw.tools)
    ? raw.tools
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .map((t) => ({
          agent: asStr(t.agent),
          connectors: Array.isArray(t.connectors)
            ? t.connectors
                .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
                .map((c) => ({ name: asStr(c.name), status: asStr(c.status, 'unknown') }))
                .filter((c) => c.name)
            : [],
        }))
        .filter((t) => t.agent)
    : []

  const conversations: CockpitConversation[] = Array.isArray(raw.conversations)
    ? raw.conversations
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => {
          const conv: CockpitConversation = {
            id: asStr(c.id),
            agent: asStr(c.agent),
            cost_usd: asNum(c.cost_usd),
            turns: asNum(c.turns),
            last_ts: asStr(c.last_ts),
            title: asStr(c.title),
          }
          if (typeof c.status === 'string') conv.status = c.status
          if (typeof c.reply === 'string') conv.reply = c.reply
          if (c.awaiting_approval === true) conv.awaiting_approval = true
          return conv
        })
        .filter((c) => c.id)
    : []

  const pending_approvals: CockpitPendingApproval[] = Array.isArray(raw.pending_approvals)
    ? raw.pending_approvals
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => ({
          id: asStr(a.id),
          agent: asStr(a.agent),
          kind: asStr(a.kind, 'action'),
          summary: asStr(a.summary),
          requested_at: asStr(a.requested_at),
          cost_cap_usd: asNum(a.cost_cap_usd),
          impact: asStr(a.impact, 'unknown'),
          reversible: a.reversible === true,
        }))
        .filter((a) => a.id)
    : []

  return {
    generated_at: asStr(raw.generated_at, new Date().toISOString()),
    week_now: raw.week_now != null ? asNum(raw.week_now, isoWeekNow()) : isoWeekNow(),
    timeline,
    agent_feed,
    tools,
    conversations,
    pending_approvals,
  }
}

export async function readCockpit(): Promise<CockpitPayload> {
  try {
    const rawText = await fs.readFile(cockpitFilePath(), 'utf-8')
    const parsed = JSON.parse(rawText)
    if (!parsed || typeof parsed !== 'object') return emptyCockpit()
    return { ...coerce(parsed as Record<string, unknown>), source: 'live' }
  } catch {
    // Missing mount, missing file, or invalid JSON → honest empty state.
    return emptyCockpit()
  }
}

export function cockpitPath(): string {
  return path.resolve(cockpitFilePath())
}
