/**
 * EPL decisions / backlog — real SQLite backing.
 *
 * This replaces the old hardcoded mock list in /api/epl/decisions. It is the
 * shared "sink" of the meeting → backlog intake loop:
 *
 *   Edward (read-only scanner)  → extracts candidate action items
 *     → mc_decisions_writer.py  → POST /api/epl/decisions   (createDecision)
 *       → Gerda approves in MC  → POST .../[id]/decision     (applyDecisionAction)
 *         → Atlas routes        → GET  ?part=routable        (listRoutable)
 *           → appends to target agent ROADMAP
 *             → POST .../[id]/routed                          (markRouted)
 *
 * Design rules honoured:
 *   - Idempotent intake: deterministic ids + INSERT OR IGNORE, so re-running a
 *     scan never duplicates rows.
 *   - Append-only intent: routing is a state flag, never a destructive write.
 *   - Backwards compatible: the original 32 mock decisions are seeded once
 *     (source='mock') so nothing in the existing panel regresses.
 */

import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { getDatabase } from './db'

export type DecisionStatus = 'open' | 'decided' | 'blocked'
export type DecisionAction = 'approve' | 'reject' | 'discuss'
export type RoutingStatus = 'none' | 'pending' | 'routed' | 'failed'

/** JSON payload an intake source attaches so Atlas knows where to route. */
export interface ProposedPayload {
  target_agent: string
  rationale?: string
  evidence?: string[]
  meeting?: string
  meeting_date?: string
  roadmap_path?: string
}

export interface EplDecision {
  id: string
  title: string
  category: string
  status: DecisionStatus
  age_days: number
  owner: string
  recommendation?: string
  default_applied?: string
  source: string
  proposed_payload?: ProposedPayload
  decision_action?: DecisionAction
  decided_by?: string
  decided_at?: number
  note?: string
  routing_status: RoutingStatus
  routed_to?: string
  routed_at?: number
  created_at: number
  updated_at: number
}

/** Input accepted by the intake endpoint. */
export interface CreateDecisionInput {
  title: string
  category?: string
  owner?: string
  recommendation?: string
  default_applied?: string
  source: string
  proposed_payload?: ProposedPayload
  /** Caller-supplied id; if absent a deterministic one is derived. */
  id?: string
  /** Caller-supplied dedupe key; if absent derived from source|meeting_date|title. */
  dedupe_key?: string
}

const DAY_SECONDS = 86_400

// ---------------------------------------------------------------------------
// Seed: the original 32 mock decisions (ported verbatim, source='mock').
// ---------------------------------------------------------------------------

interface SeedRow {
  id: string
  title: string
  category: string
  status: DecisionStatus
  age_days: number
  owner: string
  recommendation?: string
  default_applied?: string
}

const SEED_DECISIONS: SeedRow[] = [
  { id: 'R1', title: 'Pacific Estates VAUXHALL — approve draft', category: 'Rapid', status: 'open', age_days: 4, owner: 'Larry', recommendation: 'Approve tier=moderate (option_b £1,200 → Arianne cc, needs_gerda_personal_approval=true).' },
  { id: 'R2', title: 'Hugo Green API signup — go ahead', category: 'Hugo', status: 'open', age_days: 0, owner: 'Jose' },
  { id: 'R3', title: 'Hill House counter-offer wording', category: 'Rapid', status: 'open', age_days: 11, owner: 'Nathan', recommendation: 'Counter at £4,800 PCM (£200 below ask) + 5yr + 2-wk rent free; Atlas drafted v1.' },
  { id: 'R4', title: 'Hugo VPS systemd + nginx — deploy tonight?', category: 'Hugo', status: 'open', age_days: 0, owner: 'Gerda' },
  { id: 'R5', title: 'MC custom panel colours — approve heat-state palette', category: 'MC build', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Locked 26 May evening — heat-hot/warm/neutral/cool/cold.' },
  { id: 'R6', title: 'AI Policies P01 (drafts-only) — go LIVE', category: 'AI Policies', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: LIVE for all agents from Mon 1 Jun.' },
  { id: 'R7', title: 'Owen agent — approve name + share v2 sheet with SA', category: 'Architecture', status: 'open', age_days: 0, owner: 'Gerda' },
  { id: 'R8', title: 'Hanna replacement — split into 2 roles (Sales + Exec PA)', category: 'Rapid', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: split confirmed; salary bands pending Gerda.' },
  { id: 'R9', title: 'Maintenance Slack channel — keep C047DN2FBND or new?', category: 'Maintenance', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Keep existing #maintenance (20 members since 2022).' },
  { id: 'R10', title: 'Hugo £ ceiling — £100 auto-approve / £500 alert?', category: 'AI Policies', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: £100 auto / £500 alert / £500+ requires Gerda.' },
  { id: 'R11', title: 'Hanna replacement JDs — set salary bands', category: 'Rapid', status: 'open', age_days: 0, owner: 'Gerda' },
  { id: 'R12', title: 'Property registry hygiene — TBC flat numbers (Shoreditch studio)', category: 'Architecture', status: 'open', age_days: 0, owner: 'Larry' },
  { id: 'R13', title: 'Atlas Daily Brief — add Kris config (Hugo KPIs)?', category: 'Architecture', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: Yes — Kris brief 09:00 BST with maintenance KPIs.' },
  { id: 'R14', title: 'AI Policies P07 (SLA tiers) — go LIVE', category: 'AI Policies', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: LIVE — operationalises Policy 45 (BAM guest SLA) + sibling Policy 46 (maintenance).' },
  { id: 'R15', title: 'AI Policies P12 (read-existing-first) — go LIVE', category: 'AI Policies', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: LIVE — enforced by Edward Friday scan.' },
  { id: 'R16', title: 'Emergent (Jose) for visual layer — confirmed?', category: 'MC build', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Confirmed — Jose runs Emergent shootout Wk1.' },
  { id: 'R17', title: 'mc.str-agents.com SSO — Cloudflare Access or built-in?', category: 'MC build', status: 'open', age_days: 0, owner: 'Jose', default_applied: 'DEFAULT: Cloudflare Access (Wk3 eval).' },
  { id: 'R18', title: 'Asana sunset date — Wk4 or Wk6?', category: 'MC build', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: Wk4 — once Projects panel ships.' },
  { id: 'R19', title: 'Property Aliases — add SHOREDITCH_STUDIO flat number', category: 'Architecture', status: 'blocked', age_days: 0, owner: 'Dana Connolly (landlord)' },
  { id: 'R20', title: 'Hugo Phase 2 — auto-reassign on no-ack within SLA', category: 'Hugo', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: P0 30min / P1 2h / P2 24h.' },
  { id: 'R21', title: 'BOOM canonical confirmation — Properties panel source of truth', category: 'Architecture', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Confirmed — BOOM canonical for property list; PriceLabs for occupancy (per Feb).' },
  { id: 'R22', title: 'Aria PriceLabs sync — who approves now Hanna gone?', category: 'Architecture', status: 'open', age_days: 19, owner: 'Arianne', default_applied: 'DEFAULT: Arianne takes pricing approver role.' },
  { id: 'R23', title: 'Slack ID Hanna/Abuzar denylist — bake into all agent code', category: 'AI Policies', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Confirmed — INACTIVE_SLACK_IDS = {U07FQ300EVB, U09MSN2EFK6}.' },
  { id: 'R24', title: 'Hugo backfill 12,880-line corpus — when?', category: 'Hugo', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: Tomorrow morning after migration runs.' },
  { id: 'R25', title: 'Maintenance Atlas KPI — show in Kris brief?', category: 'Maintenance', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Confirmed — wired this session.' },
  { id: 'R26', title: 'Exec PA hire — Sofia extension or new agent?', category: 'Architecture', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: human first, then Sofia takes overflow.' },
  { id: 'R27', title: 'Owen Slack channel — #operations or new?', category: 'Architecture', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: #operations.' },
  { id: 'R28', title: 'Token caps per agent (£40-200/mo)', category: 'AI Policies', status: 'open', age_days: 0, owner: 'Gerda', default_applied: 'DEFAULT: £200 Sofia/Atlas; £100 James/Aria/Larry; £40 others.' },
  { id: 'R29', title: 'Iris reactive vs Owen proactive — clear boundaries', category: 'Architecture', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Iris = review-driven; Owen = research-driven. Documented.' },
  { id: 'R30', title: 'Property scoring — Hot/Star/Cold thresholds', category: 'MC build', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Hot = occ>90 AND score>4.5; Star = score>=4.7; Cold = onboarding OR occ<60.' },
  { id: 'R31', title: 'Sofia legal-status drafting rule — patch deployed', category: 'AI Policies', status: 'decided', age_days: 0, owner: 'Gerda', default_applied: 'Shipped 26 May — 2-line ack-and-pass on RRA/lease/S21/S8 notices.' },
  { id: 'R32', title: 'MC custom panels — REACT generation pipeline', category: 'MC build', status: 'open', age_days: 0, owner: 'Jose', default_applied: 'DEFAULT: Jose runs Emergent on each HTML mockup → drops React into src/components/panels/epl-*.tsx.' },
]

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface DbRow {
  id: string
  title: string
  category: string
  status: string
  age_days: number
  owner: string
  recommendation: string | null
  default_applied: string | null
  source: string
  proposed_payload: string | null
  decision_action: string | null
  decided_by: string | null
  decided_at: number | null
  note: string | null
  routing_status: string
  routed_to: string | null
  routed_at: number | null
  created_at: number
  updated_at: number
}

function rowToDecision(r: DbRow): EplDecision {
  // age_days is the larger of the stored seed value and the real elapsed days
  // since creation — so intake rows age naturally while seed rows keep their
  // hand-set age until time overtakes it.
  const elapsed = Math.floor((Date.now() / 1000 - r.created_at) / DAY_SECONDS)
  let payload: ProposedPayload | undefined
  if (r.proposed_payload) {
    try { payload = JSON.parse(r.proposed_payload) as ProposedPayload } catch { payload = undefined }
  }
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    status: (r.status as DecisionStatus) ?? 'open',
    age_days: Math.max(r.age_days ?? 0, elapsed >= 0 ? elapsed : 0),
    owner: r.owner,
    recommendation: r.recommendation ?? undefined,
    default_applied: r.default_applied ?? undefined,
    source: r.source,
    proposed_payload: payload,
    decision_action: (r.decision_action as DecisionAction) ?? undefined,
    decided_by: r.decided_by ?? undefined,
    decided_at: r.decided_at ?? undefined,
    note: r.note ?? undefined,
    routing_status: (r.routing_status as RoutingStatus) ?? 'none',
    routed_to: r.routed_to ?? undefined,
    routed_at: r.routed_at ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

let seeded = false

/** Seed the 32 legacy decisions once. Idempotent (INSERT OR IGNORE). */
export function ensureDecisionsSeeded(db = getDatabase()): void {
  if (seeded) return
  const insert = db.prepare(`
    INSERT OR IGNORE INTO epl_decisions
      (id, title, category, status, age_days, owner, recommendation, default_applied, source)
    VALUES (@id, @title, @category, @status, @age_days, @owner, @recommendation, @default_applied, 'mock')
  `)
  const tx = db.transaction((rows: SeedRow[]) => {
    for (const row of rows) {
      insert.run({
        id: row.id,
        title: row.title,
        category: row.category,
        status: row.status,
        age_days: row.age_days,
        owner: row.owner,
        recommendation: row.recommendation ?? null,
        default_applied: row.default_applied ?? null,
      })
    }
  })
  tx(SEED_DECISIONS)
  seeded = true
}

// ---------------------------------------------------------------------------
// Deterministic id
// ---------------------------------------------------------------------------

function prefixFor(source: string): string {
  const s = source.toLowerCase()
  if (s === 'zoom' || s === 'edward') return 'EZ-'
  if (s === 'email' || s === 'mail') return 'M-'
  return 'D-'
}

/** Stable id from a dedupe key so repeat intake of the same item collapses. */
export function genId(source: string, dedupeKey: string): string {
  const hash = createHash('sha1').update(dedupeKey).digest('hex').slice(0, 10)
  return `${prefixFor(source)}${hash}`
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listDecisions(db = getDatabase()): EplDecision[] {
  ensureDecisionsSeeded(db)
  const rows = db.prepare(`SELECT * FROM epl_decisions ORDER BY created_at ASC, id ASC`).all() as DbRow[]
  return rows.map(rowToDecision)
}

export function getDecision(id: string, db = getDatabase()): EplDecision | null {
  ensureDecisionsSeeded(db)
  const row = db.prepare(`SELECT * FROM epl_decisions WHERE id = ?`).get(id) as DbRow | undefined
  return row ? rowToDecision(row) : null
}

/** Open items already approved and awaiting Atlas routing. */
export function listRoutable(db = getDatabase()): EplDecision[] {
  ensureDecisionsSeeded(db)
  const rows = db.prepare(`
    SELECT * FROM epl_decisions WHERE routing_status = 'pending' ORDER BY decided_at ASC, id ASC
  `).all() as DbRow[]
  return rows.map(rowToDecision)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Idempotent intake. Returns the resulting decision and whether a new row was
 * inserted (false = it already existed, i.e. a re-scan of the same item).
 */
export function createDecision(
  input: CreateDecisionInput,
  db = getDatabase(),
): { decision: EplDecision; inserted: boolean } {
  ensureDecisionsSeeded(db)
  const source = input.source || 'manual'
  const dedupeKey =
    input.dedupe_key ??
    `${source}|${input.proposed_payload?.meeting_date ?? ''}|${input.title}`
  const id = input.id ?? genId(source, dedupeKey)

  const result = db.prepare(`
    INSERT OR IGNORE INTO epl_decisions
      (id, title, category, status, age_days, owner, recommendation, default_applied, source, proposed_payload, routing_status)
    VALUES (@id, @title, @category, 'open', 0, @owner, @recommendation, @default_applied, @source, @proposed_payload, 'none')
  `).run({
    id,
    title: input.title,
    category: input.category ?? 'Architecture',
    owner: input.owner ?? 'Gerda',
    recommendation: input.recommendation ?? null,
    default_applied: input.default_applied ?? null,
    source,
    proposed_payload: input.proposed_payload ? JSON.stringify(input.proposed_payload) : null,
  })

  const decision = getDecision(id, db)!
  return { decision, inserted: result.changes > 0 }
}

/**
 * Record Gerda's approve/reject/discuss.
 *   - approve / reject → status becomes 'decided'
 *   - discuss          → status unchanged (still open, just noted)
 *   - approve AND the row carries a routable target_agent → routing_status='pending'
 *
 * Returns null if the id is unknown.
 */
export function applyDecisionAction(
  id: string,
  action: DecisionAction,
  note: string | undefined,
  actor: string,
  db = getDatabase(),
): EplDecision | null {
  ensureDecisionsSeeded(db)
  const existing = db.prepare(`SELECT * FROM epl_decisions WHERE id = ?`).get(id) as DbRow | undefined
  if (!existing) return null

  const newStatus: DecisionStatus = action === 'discuss' ? (existing.status as DecisionStatus) : 'decided'

  let routableTarget = false
  if (action === 'approve' && existing.proposed_payload) {
    try {
      const payload = JSON.parse(existing.proposed_payload) as ProposedPayload
      routableTarget = Boolean(payload?.target_agent)
    } catch {
      routableTarget = false
    }
  }
  // Only move 'none' → 'pending'. Never regress an already-routed item.
  const newRouting: RoutingStatus =
    routableTarget && existing.routing_status === 'none' ? 'pending' : (existing.routing_status as RoutingStatus)

  db.prepare(`
    UPDATE epl_decisions
    SET status = ?, decision_action = ?, decided_by = ?, decided_at = unixepoch(),
        note = ?, routing_status = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(newStatus, action, actor, note ?? null, newRouting, id)

  return getDecision(id, db)
}

/** Atlas confirms it has appended the item to the target ROADMAP. */
export function markRouted(id: string, routedTo: string, db = getDatabase()): EplDecision | null {
  ensureDecisionsSeeded(db)
  const existing = db.prepare(`SELECT id FROM epl_decisions WHERE id = ?`).get(id) as { id: string } | undefined
  if (!existing) return null
  db.prepare(`
    UPDATE epl_decisions
    SET routing_status = 'routed', routed_to = ?, routed_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ?
  `).run(routedTo, id)
  return getDecision(id, db)
}

// ---------------------------------------------------------------------------
// Auth helper for agent-facing write endpoints
// ---------------------------------------------------------------------------

/**
 * Gate agent writes (intake, mark-routed) behind the MC API key.
 * If API_KEY is unset (dev / standalone-without-key) we allow through, mirroring
 * the tolerance in agents/_helpers.ts. When set, require a matching x-api-key.
 */
export function checkApiKey(req: NextRequest): boolean {
  const expected = process.env.API_KEY
  if (!expected) return true
  return req.headers.get('x-api-key') === expected
}
