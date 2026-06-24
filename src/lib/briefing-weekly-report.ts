/**
 * Weekly landlord reports.
 *
 * Every Friday the scheduler builds one landlord-safe report per property that
 * had incident activity in the trailing 7 days. Landlord-safe means: RESOLVED
 * incidents only, no internal notes / assignees / conflict flags — just what
 * happened, what it cost, and the guest-satisfaction trend.
 *
 * Output is print-ready HTML written under `<dataDir>/reports/landlord/<year>/
 * <Month>/<Property>_Week<NN>.html`. HTML (not PDF) is the shipped format: MC
 * has no PDF renderer or Drive credentials, so a clean printable HTML that an
 * operator (or a downstream sync job) can render-to-PDF and drop into Drive is
 * the honest, non-fragile deliverable. Drive upload + PDF rendering are a
 * documented follow-up (see roadmap Phase 3c).
 */

import type Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { config } from './config'
import { logger } from './logger'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface Incident {
  property_id: string
  title: string
  description: string | null
  category: string | null
  severity: string | null
  status: string | null
  resolved_date: number | null
  cost: number | null
  guest_sentiment: string | null
  guest_impact_score: number | null
}

/** ISO-8601 week number (1-53). */
export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function reportsRoot(): string {
  return process.env.MC_REPORTS_DIR || join(config.dataDir, 'reports', 'landlord')
}

/** Build the landlord-safe HTML for one property's resolved incidents. */
export function buildLandlordReportHtml(params: {
  propertyId: string
  weekNo: number
  year: number
  rangeLabel: string
  incidents: Incident[]
}): string {
  const { propertyId, weekNo, year, rangeLabel, incidents } = params

  const totalCost = incidents.reduce((sum, i) => sum + (Number(i.cost) || 0), 0)
  const sentiments = incidents.map((i) => i.guest_sentiment).filter(Boolean) as string[]
  const positive = sentiments.filter((s) => s === 'positive').length
  const negative = sentiments.filter((s) => s === 'negative').length
  const satisfaction = sentiments.length === 0
    ? 'No guest feedback this week'
    : negative === 0
      ? 'Stable / positive'
      : positive >= negative
        ? 'Mostly positive, some concerns addressed'
        : 'Needs attention — concerns being resolved'

  const rows = incidents
    .map(
      (i) => `      <tr>
        <td>${esc(i.title)}</td>
        <td>${esc(i.category || '—')}</td>
        <td>${esc(i.description ? i.description.slice(0, 200) : '—')}</td>
        <td>${i.resolved_date ? new Date(i.resolved_date * 1000).toISOString().split('T')[0] : '—'}</td>
        <td style="text-align:right">${i.cost != null ? '£' + Number(i.cost).toFixed(2) : '—'}</td>
      </tr>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(propertyId)} — Week ${weekNo} ${year}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; max-width: 800px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #666; margin-top: 0; }
  .summary { display: flex; gap: 24px; margin: 24px 0; }
  .card { background: #f5f5f7; border-radius: 8px; padding: 16px 20px; flex: 1; }
  .card .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 20px; font-weight: 600; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { background: #fafafa; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: #555; }
  .footer { margin-top: 32px; color: #999; font-size: 12px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>Property Report — ${esc(propertyId)}</h1>
  <p class="sub">Week ${weekNo}, ${year} &middot; ${esc(rangeLabel)}</p>

  <div class="summary">
    <div class="card"><div class="label">Items resolved</div><div class="value">${incidents.length}</div></div>
    <div class="card"><div class="label">Maintenance cost</div><div class="value">£${totalCost.toFixed(2)}</div></div>
    <div class="card"><div class="label">Guest satisfaction</div><div class="value" style="font-size:15px">${esc(satisfaction)}</div></div>
  </div>

  <h2 style="font-size:16px">Resolved this week</h2>
  ${incidents.length === 0
    ? '<p>No resolved items to report for this period.</p>'
    : `<table>
    <thead><tr><th>Item</th><th>Type</th><th>Detail</th><th>Resolved</th><th style="text-align:right">Cost</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`}

  <p class="footer">Generated by Mission Control. Resolved items only — internal operational notes excluded.</p>
</body>
</html>`
}

export interface WeeklyReportResult {
  ok: boolean
  message: string
  files: string[]
}

/**
 * Generate weekly landlord reports for all properties with resolved incidents
 * in the trailing 7 days. Returns the list of written file paths.
 */
export function generateWeeklyLandlordReports(
  db: Database.Database,
  opts: { workspaceId?: number; now?: Date } = {},
): WeeklyReportResult {
  try {
    const workspaceId = opts.workspaceId ?? 1
    const now = opts.now ?? new Date()
    const nowSec = Math.floor(now.getTime() / 1000)
    const weekAgoSec = nowSec - 7 * 86400

    const weekNo = isoWeekNumber(now)
    const year = now.getUTCFullYear()
    const monthName = MONTHS[now.getUTCMonth()]
    const rangeLabel = `${new Date(weekAgoSec * 1000).toISOString().split('T')[0]} – ${now.toISOString().split('T')[0]}`

    // Resolved incidents in the trailing week. Landlord-safe columns only.
    const incidents = db
      .prepare(
        `SELECT property_id, title, description, category, severity, status,
                resolved_date, cost, guest_sentiment, guest_impact_score
         FROM property_incidents
         WHERE workspace_id = ?
           AND status = 'resolved'
           AND resolved_date IS NOT NULL
           AND resolved_date >= ?
         ORDER BY property_id ASC, resolved_date ASC`,
      )
      .all(workspaceId, weekAgoSec) as Incident[]

    if (incidents.length === 0) {
      return { ok: true, message: 'No resolved incidents this week — no reports generated', files: [] }
    }

    // Group by property.
    const byProperty = new Map<string, Incident[]>()
    for (const i of incidents) {
      const arr = byProperty.get(i.property_id) || []
      arr.push(i)
      byProperty.set(i.property_id, arr)
    }

    const baseDir = join(reportsRoot(), String(year), monthName)
    const files: string[] = []

    for (const [propertyId, propIncidents] of byProperty) {
      const html = buildLandlordReportHtml({ propertyId, weekNo, year, rangeLabel, incidents: propIncidents })
      const safeName = propertyId.replace(/[^a-zA-Z0-9_-]+/g, '_')
      const filePath = join(baseDir, `${safeName}_Week${String(weekNo).padStart(2, '0')}.html`)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, html, 'utf-8')
      files.push(filePath)
    }

    return {
      ok: true,
      message: `Generated ${files.length} landlord report(s) for week ${weekNo} → ${baseDir}`,
      files,
    }
  } catch (err: any) {
    logger.error({ err }, 'Weekly landlord report generation failed')
    return { ok: false, message: `Weekly report failed: ${err.message}`, files: [] }
  }
}
