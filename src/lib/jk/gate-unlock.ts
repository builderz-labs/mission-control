/**
 * Gate Unlock — after an approval decision, scaffold the next gate.
 *
 * In production this would dispatch to GanCMO via Hermes. For now it creates a
 * pending item immediately so the queue is populated and visible in the UI.
 * Real AI-generated content is injected when GanCMO responds.
 */

import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import type { GateType } from './approval-queue'

interface ApprovalRow {
  id: number
  brand_id: number
  gate_number: number
  gate_type: GateType
  service_type: string
  month_year: string
  status: string
}

const NEXT_GATE_TYPE: Record<number, GateType> = {
  1: 'cep_selection',
  2: 'content_brief',
  3: 'content_execution',
}

const NEXT_GATE_SUMMARY: Record<number, string> = {
  1: 'Menunggu GanCMO: seleksi CEP prioritas untuk bulan ini berdasarkan NSM dan historical performa.',
  2: 'Menunggu GanCMO: generasi content brief per CEP terpilih.',
  3: 'Menunggu GanCMO: jadwal eksekusi konten final beserta caption dan visual brief.',
}

/**
 * Called after Gate N is approved. Scaffolds Gate N+1 as a pending item.
 * If Gate N = 4 (last gate), no new item is created.
 */
export function triggerNextGate(approvedItemId: number): void {
  const db = getDatabase()
  const item = db.prepare('SELECT * FROM hm_approval_queue WHERE id = ?').get(approvedItemId) as ApprovalRow | undefined
  if (!item) return
  if (item.gate_number >= 4) return // last gate — nothing to unlock

  const nextGate = item.gate_number + 1
  const nextGateType = NEXT_GATE_TYPE[item.gate_number]
  if (!nextGateType) return

  // Don't create if one already exists for this brand+month+gate (idempotent)
  const existing = db.prepare(`
    SELECT id FROM hm_approval_queue
    WHERE brand_id = ? AND month_year = ? AND gate_number = ? AND status != 'superseded'
  `).get(item.brand_id, item.month_year, nextGate)
  if (existing) return

  const result = db.prepare(`
    INSERT INTO hm_approval_queue
      (brand_id, gate_number, gate_type, service_type, month_year, status, agent_id, summary_text, supporting_data)
    VALUES (?, ?, ?, ?, ?, 'pending', 'system', ?, ?)
  `).run(
    item.brand_id,
    nextGate,
    nextGateType,
    item.service_type,
    item.month_year,
    NEXT_GATE_SUMMARY[item.gate_number] ?? `Gate ${nextGate} ready for GanCMO.`,
    JSON.stringify({ trigger_source: 'gate_unlock', approved_gate: item.gate_number, approved_item_id: approvedItemId }),
  )

  eventBus.broadcast('jk.approval.created', {
    id: result.lastInsertRowid,
    brand_id: item.brand_id,
    gate_number: nextGate,
    triggered_by_gate: item.gate_number,
  })
}

/**
 * Return the next gate that should be unlocked for a brand+month, or null if all done.
 */
export function getNextLockedGate(brandId: number, monthYear: string): number | null {
  const db = getDatabase()
  for (let g = 1; g <= 4; g++) {
    const row = db.prepare(`
      SELECT status FROM hm_approval_queue
      WHERE brand_id = ? AND month_year = ? AND gate_number = ? AND status != 'superseded'
      ORDER BY id DESC LIMIT 1
    `).get(brandId, monthYear, g) as { status: string } | undefined
    if (!row) return g // empty = next gate to fill
    if (row.status === 'pending') return null // gate in progress
  }
  return null // all gates done
}
