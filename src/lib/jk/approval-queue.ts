import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'

export type GateType =
  | 'monthly_strategy'
  | 'cep_selection'
  | 'content_brief'
  | 'content_execution'
  | 'seo_plan'
  | 'ads_plan'
  | 'milestone_approval'

export type ApprovalStatus = 'pending' | 'approved' | 'adjusted' | 'rejected' | 'superseded'

export type RejectionCategory = 'wrong_format' | 'wrong_direction' | 'data_error' | 'other'

export interface ApprovalQueueItem {
  id: number
  brand_id: number
  project_id: number | null
  gate_number: number
  gate_type: GateType
  service_type: string
  month_year: string
  status: ApprovalStatus
  agent_id: string | null
  summary_text: string | null
  full_output: string | null
  supporting_data: string | null
  decision_by: string | null
  decision_at: number | null
  adjustment_text: string | null
  rejection_reason: string | null
  rejection_category: RejectionCategory | null
  supersedes_id: number | null
  generated_at: number
  expires_at: number | null
  created_at: number
}

export interface GateStatus {
  gate_number: number
  gate_type: GateType
  status: 'approved' | 'pending' | 'locked' | 'empty'
  item_count: number
}

/** Check whether a gate's prerequisite gate is fully approved for a brand+month */
function isPreviousGateApproved(brandId: number, gateNumber: number, monthYear: string): boolean {
  if (gateNumber <= 1) return true
  const db = getDatabase()
  const prevGate = gateNumber - 1
  const pending = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM hm_approval_queue
    WHERE brand_id = ? AND gate_number = ? AND month_year = ?
      AND status NOT IN ('approved', 'adjusted')
  `).get(brandId, prevGate, monthYear) as { cnt: number }
  const exists = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM hm_approval_queue
    WHERE brand_id = ? AND gate_number = ? AND month_year = ?
  `).get(brandId, prevGate, monthYear) as { cnt: number }
  return exists.cnt > 0 && pending.cnt === 0
}

/** Create a new approval queue entry (agent output ready for review) */
export function createApprovalItem(params: {
  brand_id: number
  project_id?: number
  gate_number: number
  gate_type: GateType
  service_type?: string
  month_year: string
  agent_id?: string
  summary_text: string
  full_output?: object
  supporting_data?: object
  expires_at?: number
}): number {
  if (!isPreviousGateApproved(params.brand_id, params.gate_number, params.month_year)) {
    throw new Error(`Gate ${params.gate_number - 1} must be approved before generating Gate ${params.gate_number}`)
  }
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO hm_approval_queue
      (brand_id, project_id, gate_number, gate_type, service_type, month_year,
       status, agent_id, summary_text, full_output, supporting_data, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    params.brand_id,
    params.project_id ?? null,
    params.gate_number,
    params.gate_type,
    params.service_type ?? 'brand',
    params.month_year,
    params.agent_id ?? null,
    params.summary_text,
    params.full_output ? JSON.stringify(params.full_output) : null,
    params.supporting_data ? JSON.stringify(params.supporting_data) : null,
    params.expires_at ?? null,
  )
  const id = result.lastInsertRowid as number
  eventBus.broadcast('jk.approval.created', { id, brand_id: params.brand_id, gate_number: params.gate_number })
  return id
}

/** Approve an approval item — hard-checks gate prerequisites */
export function approveItem(id: number, decidedBy: string): void {
  const db = getDatabase()
  const item = db.prepare('SELECT * FROM hm_approval_queue WHERE id = ?').get(id) as ApprovalQueueItem | undefined
  if (!item) throw new Error('Approval item not found')
  if (item.status !== 'pending') throw new Error(`Cannot approve item with status: ${item.status}`)

  db.prepare(`
    UPDATE hm_approval_queue
    SET status = 'approved', decision_by = ?, decision_at = unixepoch()
    WHERE id = ?
  `).run(decidedBy, id)

  eventBus.broadcast('jk.approval.approved', { id, brand_id: item.brand_id, gate_number: item.gate_number })
}

/** Adjust an approval item — archives current, creates new version */
export function adjustItem(id: number, adjustmentText: string, decidedBy: string): number {
  const db = getDatabase()
  const item = db.prepare('SELECT * FROM hm_approval_queue WHERE id = ?').get(id) as ApprovalQueueItem | undefined
  if (!item) throw new Error('Approval item not found')
  if (item.status !== 'pending') throw new Error(`Cannot adjust item with status: ${item.status}`)

  db.transaction(() => {
    db.prepare(`
      UPDATE hm_approval_queue
      SET status = 'adjusted', decision_by = ?, decision_at = unixepoch(), adjustment_text = ?
      WHERE id = ?
    `).run(decidedBy, adjustmentText, id)

    // Create new pending item as revised version
    db.prepare(`
      INSERT INTO hm_approval_queue
        (brand_id, project_id, gate_number, gate_type, service_type, month_year,
         status, agent_id, summary_text, full_output, supporting_data, supersedes_id)
      SELECT brand_id, project_id, gate_number, gate_type, service_type, month_year,
             'pending', agent_id, summary_text, full_output, supporting_data, ?
      FROM hm_approval_queue WHERE id = ?
    `).run(id, id)
  })()

  const newItem = db.prepare(`
    SELECT id FROM hm_approval_queue WHERE supersedes_id = ? ORDER BY id DESC LIMIT 1
  `).get(id) as { id: number }

  eventBus.broadcast('jk.approval.adjusted', { id, new_id: newItem.id, brand_id: item.brand_id })
  return newItem.id
}

/** Reject an approval item */
export function rejectItem(params: {
  id: number
  rejection_reason: string
  rejection_category: RejectionCategory
  decided_by: string
}): void {
  const db = getDatabase()
  const item = db.prepare('SELECT * FROM hm_approval_queue WHERE id = ?').get(params.id) as ApprovalQueueItem | undefined
  if (!item) throw new Error('Approval item not found')
  if (item.status !== 'pending') throw new Error(`Cannot reject item with status: ${item.status}`)

  db.prepare(`
    UPDATE hm_approval_queue
    SET status = 'rejected', decision_by = ?, decision_at = unixepoch(),
        rejection_reason = ?, rejection_category = ?
    WHERE id = ?
  `).run(params.decided_by, params.rejection_reason, params.rejection_category, params.id)

  eventBus.broadcast('jk.approval.rejected', { id: params.id, brand_id: item.brand_id })
}

/** Get pending queue for a brand+month, ordered by gate */
export function getPendingQueue(brandId: number, monthYear: string): ApprovalQueueItem[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM hm_approval_queue
    WHERE brand_id = ? AND month_year = ? AND status = 'pending'
    ORDER BY gate_number ASC, id ASC
  `).all(brandId, monthYear) as ApprovalQueueItem[]
}

/** Get gate pipeline status for a brand+month (gates 1–4) */
export function getGatePipeline(brandId: number, monthYear: string): GateStatus[] {
  const db = getDatabase()
  const gates: GateStatus[] = []

  for (let g = 1; g <= 4; g++) {
    const rows = db.prepare(`
      SELECT status FROM hm_approval_queue
      WHERE brand_id = ? AND month_year = ? AND gate_number = ?
        AND status != 'superseded'
      ORDER BY id DESC
    `).all(brandId, monthYear, g) as Array<{ status: string }>

    if (rows.length === 0) {
      const prevApproved = g === 1 || isPreviousGateApproved(brandId, g, monthYear)
      gates.push({ gate_number: g, gate_type: gateTypeForNumber(g), status: prevApproved ? 'empty' : 'locked', item_count: 0 })
    } else if (rows.every(r => r.status === 'approved' || r.status === 'adjusted')) {
      gates.push({ gate_number: g, gate_type: gateTypeForNumber(g), status: 'approved', item_count: rows.length })
    } else {
      gates.push({ gate_number: g, gate_type: gateTypeForNumber(g), status: 'pending', item_count: rows.length })
    }
  }
  return gates
}

function gateTypeForNumber(gate: number): GateType {
  const map: Record<number, GateType> = {
    1: 'monthly_strategy',
    2: 'cep_selection',
    3: 'content_brief',
    4: 'content_execution',
  }
  return map[gate] ?? 'monthly_strategy'
}
