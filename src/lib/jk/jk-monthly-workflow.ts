/**
 * JK Monthly Workflow — GanPM trigger logic.
 *
 * Runs on the 1st of each month (or manually via API) for every active brand.
 * For each brand that doesn't yet have a Gate 1 item for the current month,
 * creates a pending Gate 1 (monthly_strategy) item so the approval queue is
 * populated and visible to the team.
 *
 * In a fully agentic setup, this would dispatch a Hermes task to GanPM who
 * generates the actual strategy analysis before inserting the item. For now
 * the item is created with scaffold content so the workflow can begin.
 */

import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'

export interface WorkflowRunResult {
  brands_processed: number
  gates_created: number
  brands_skipped: number
  errors: string[]
  month_year: string
}

/**
 * Generate Gate 1 items for all active brands that are missing one this month.
 * Safe to call multiple times — idempotent per brand+month.
 */
export function runMonthlyWorkflow(monthYear?: string): WorkflowRunResult {
  const db = getDatabase()
  const my = monthYear ?? new Date().toISOString().slice(0, 7)

  const result: WorkflowRunResult = {
    brands_processed: 0,
    gates_created: 0,
    brands_skipped: 0,
    errors: [],
    month_year: my,
  }

  const brands = db.prepare(`
    SELECT b.id, b.name, b.category, b.monthly_workflow_day,
           c.name as client_name
    FROM hm_brands b
    JOIN hm_clients c ON c.id = b.client_id
    WHERE b.status = 'active'
    ORDER BY b.id ASC
  `).all() as Array<{
    id: number
    name: string
    category: string | null
    monthly_workflow_day: number | null
    client_name: string
  }>

  for (const brand of brands) {
    result.brands_processed++

    // Check if Gate 1 already exists
    const existing = db.prepare(`
      SELECT id FROM hm_approval_queue
      WHERE brand_id = ? AND month_year = ? AND gate_number = 1 AND status != 'superseded'
    `).get(brand.id, my)

    if (existing) {
      result.brands_skipped++
      continue
    }

    // Build context from NSM + KPI for scaffold summary
    const nsm = db.prepare(`SELECT nsm_name, current_value, target_value FROM hm_brand_nsm WHERE brand_id = ?`).get(brand.id) as
      { nsm_name: string; current_value: number; target_value: number } | undefined

    const kpis = db.prepare(`
      SELECT service_type, kpi_name, current_value, target_value, target_unit, status
      FROM hm_brand_kpi WHERE brand_id = ?
      ORDER BY service_type, id
    `).all(brand.id) as Array<{
      service_type: string
      kpi_name: string
      current_value: number
      target_value: number
      target_unit: string
      status: string
    }>

    const offTrack = kpis.filter(k => k.status === 'off_track')
    const needsAttn = kpis.filter(k => k.status === 'needs_attention')
    const onTrack = kpis.filter(k => k.status === 'on_track')

    const summaryLines: string[] = [
      `Rekomendasi strategi ${my} untuk ${brand.name} (${brand.category ?? 'Brand'}).`,
    ]

    if (nsm) {
      const nsmPct = nsm.target_value > 0 ? Math.round((nsm.current_value / nsm.target_value) * 100) : 0
      summaryLines.push(`NSM "${nsm.nsm_name}": ${nsm.current_value}/${nsm.target_value} (${nsmPct}%).`)
    }

    if (offTrack.length > 0) {
      summaryLines.push(`⚠ ${offTrack.length} KPI off-track: ${offTrack.map(k => k.kpi_name).join(', ')}.`)
    }
    if (needsAttn.length > 0) {
      summaryLines.push(`📊 ${needsAttn.length} KPI perlu perhatian: ${needsAttn.map(k => k.kpi_name).join(', ')}.`)
    }
    if (onTrack.length > 0) {
      summaryLines.push(`✅ ${onTrack.length} KPI on-track: ${onTrack.map(k => k.kpi_name).join(', ')}.`)
    }

    summaryLines.push('Mohon review dan approve untuk membuka Gate 2 (CEP Selection).')

    const kpiRecap = kpis.reduce<Record<string, string>>((acc, k) => {
      acc[`${k.service_type}_${k.kpi_name.toLowerCase().replace(/\s+/g, '_')}`] =
        `${k.current_value}${k.target_unit} (target: ${k.target_value}${k.target_unit}) — ${k.status}`
      return acc
    }, {})

    try {
      const insertResult = db.prepare(`
        INSERT INTO hm_approval_queue
          (brand_id, gate_number, gate_type, service_type, month_year,
           status, agent_id, summary_text, supporting_data)
        VALUES (?, 1, 'monthly_strategy', 'brand', ?, 'pending', 'GanPM', ?, ?)
      `).run(
        brand.id,
        my,
        summaryLines.join(' '),
        JSON.stringify({ kpi_recap: kpiRecap, generated_by: 'jk_monthly_workflow', month_year: my }),
      )

      eventBus.broadcast('jk.approval.created', {
        id: insertResult.lastInsertRowid,
        brand_id: brand.id,
        gate_number: 1,
        source: 'monthly_workflow',
      })

      result.gates_created++
    } catch (err: any) {
      result.errors.push(`Brand ${brand.id} (${brand.name}): ${err.message}`)
    }
  }

  return result
}

/**
 * Check if the monthly workflow should run today (day matches brand's workflow day).
 * Used by cron-style triggers.
 */
export function shouldRunWorkflowToday(brandWorkflowDay: number | null): boolean {
  const today = new Date().getDate()
  return (brandWorkflowDay ?? 1) === today
}
