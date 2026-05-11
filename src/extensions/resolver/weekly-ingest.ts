/**
 * Resolver Weekly Metrics Ingest
 *
 * Tails ~/.openclaw/workspace/resolver-audit/weekly-*.md files produced by
 * the Weekly Resolver Dispatch cron and upserts rows into resolver_weekly_metrics.
 *
 * Parsing strategy:
 *   The markdown contains a "Cumulative Savings Tracker" section with token/dollar
 *   figures and a "Fleet Performance" table with success/error counts. We also
 *   extract the first "must_include_accuracy" from the weekly audit narrative when
 *   present; otherwise it falls back to null.
 *
 *   Drift is computed against the immediately prior week row already in the DB.
 *   Flagged when |drift_delta_pp| > 3 (i.e. >3 percentage-point swing).
 */

import fs from 'node:fs'
import path from 'node:path'
import { getDatabase } from '@/lib/db'
import { getOpenclawWorkspaceDir } from './workspace-paths'
import { logger } from '@/lib/logger'
import { sendDriftAlert } from './drift-alerts'
import { ensureResolverTables } from './telemetry'

export type WeeklyMetricsRow = {
  week_start: string
  must_include_recall_curated: number | null
  must_include_recall_live: number | null
  drift_delta_pp: number | null
  flagged_drift: boolean
  top_miss_tools: Array<{ toolId: string; missCount: number }>
  auto_proposed_overrides: string[]
  tokens_saved_total: number
  dollars_saved_total: number
  source_file: string
}

export type WeeklyIngestResult = {
  weeksIngested: number
  weeksSkipped: number
  driftAlertsFired: number
  errors: number
}

/**
 * Resolve the resolver audit directory. Prefers env override, then workspace default.
 */
export function resolveAuditDir(): string {
  if (process.env.MC_RESOLVER_AUDIT_DIR) return process.env.MC_RESOLVER_AUDIT_DIR
  const workspaceDir = getOpenclawWorkspaceDir()
  if (workspaceDir) {
    return path.join(workspaceDir, 'resolver-audit')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Extract week start date from filename: weekly-YYYY-MM-DD.md → YYYY-MM-DD */
export function extractWeekStartFromFilename(filename: string): string | null {
  const m = path.basename(filename).match(/^weekly-(\d{4}-\d{2}-\d{2})\.md$/)
  return m ? m[1] : null
}

/** Parse the report date from the markdown header, e.g. "**Report Date:** Sunday, April 19, 2026" */
export function extractReportDate(content: string): string | null {
  const m = content.match(/\*\*Report Date:\*\*\s+[A-Za-z]+,\s+([A-Za-z]+ \d+, \d{4})/)
  if (m) {
    const d = new Date(m[1])
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10)
    }
  }
  return null
}

/** Extract cumulative dollar savings from the savings tracker table */
export function extractDollarsSaved(content: string): number {
  const cumMatch = content.match(/\*\*Cumulative[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*\*?\*?~?\$([0-9]+\.?[0-9]*)\*?\*?/)
  if (cumMatch) return parseFloat(cumMatch[1])

  const dailyMatch = content.match(/~?\$([0-9]+\.?[0-9]*)\/day/)
  if (dailyMatch) return parseFloat(dailyMatch[1]) * 7

  return 0
}

/** Extract cumulative token savings from the savings tracker */
export function extractTokensSaved(content: string): number {
  const cumMatch = content.match(/Cumulative[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([0-9,]+)\s*\|/)
  if (cumMatch) {
    const n = parseInt(cumMatch[1].replace(/,/g, ''))
    if (!isNaN(n) && n > 0) return n
  }

  const dailyTokensMatch = content.match(/([0-9,]+)\s+tokens(?:\/day|\s+per\s+day)/)
  if (dailyTokensMatch) {
    const daily = parseInt(dailyTokensMatch[1].replace(/,/g, ''))
    if (!isNaN(daily)) return daily * 7
  }

  const tokensFreedMatch = content.match(/([0-9,]+)\s+tokens\s+freed/)
  if (tokensFreedMatch) {
    return parseInt(tokensFreedMatch[1].replace(/,/g, ''))
  }

  return 0
}

/** Extract must_include_recall from benchmark-style content if present */
export function extractMustIncludeRecall(content: string): { curated: number | null; live: number | null } {
  const accuracyMatch = content.match(/must[_\s]include[_\s]accuracy[:\s]+([0-9]\.[0-9]+)/)
  if (accuracyMatch) {
    const val = parseFloat(accuracyMatch[1])
    return { curated: val, live: null }
  }

  const pctMatches = [...content.matchAll(/(?:accuracy|recall)[:\s]+([0-9]+\.?[0-9]*)%/gi)]
  if (pctMatches.length > 0) {
    const val = parseFloat(pctMatches[0][1]) / 100
    return { curated: null, live: val }
  }

  return { curated: null, live: null }
}

/**
 * Extract tool IDs that were most commonly missing ("top miss tools").
 */
export function extractTopMissTools(content: string): Array<{ toolId: string; missCount: number }> {
  const toolCounts = new Map<string, number>()

  const critMatches = [...content.matchAll(/missing[_\s]critical[:\s]+\["([^\]"]+)"\]/g)]
  for (const m of critMatches) {
    const tool = m[1]
    toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1)
  }

  const toolPattern = /\b(web_search|web_fetch|exec|process|read|write|edit|message|memory_\w+|image|image_generate|tts|browser|code_execution|cron|sessions_\w+|subagents|canvas|pdf|video_generate|x_search|nodes|gateway)\b/g
  const ctxLines = content.split('\n').filter(l => /miss|starv|fail|error/i.test(l))
  for (const line of ctxLines) {
    const tools = [...line.matchAll(toolPattern)].map(m => m[1])
    for (const t of tools) {
      toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1)
    }
  }

  return [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([toolId, missCount]) => ({ toolId, missCount }))
}

/**
 * Extract Phase 1/2 action items as proposed overrides.
 */
export function extractAutoProposedOverrides(content: string): string[] {
  const overrides: string[] = []
  const actionMatches = [...content.matchAll(/^#{2,4} \d+\.\d+ (.+)$/gm)]
  for (const m of actionMatches) {
    const title = m[1].trim()
    if (title.length > 0 && title.length < 120) {
      overrides.push(title)
    }
  }
  return overrides.slice(0, 10)
}

// ---------------------------------------------------------------------------
// Core ingest
// ---------------------------------------------------------------------------

export function parseWeeklyMarkdown(filePath: string, content: string): WeeklyMetricsRow | null {
  const weekStartFromFile = extractWeekStartFromFilename(filePath)
  const weekStartFromContent = extractReportDate(content)
  const week_start = weekStartFromFile ?? weekStartFromContent
  if (!week_start) return null

  const { curated, live } = extractMustIncludeRecall(content)

  return {
    week_start,
    must_include_recall_curated: curated,
    must_include_recall_live: live,
    drift_delta_pp: null,
    flagged_drift: false,
    top_miss_tools: extractTopMissTools(content),
    auto_proposed_overrides: extractAutoProposedOverrides(content),
    tokens_saved_total: extractTokensSaved(content),
    dollars_saved_total: extractDollarsSaved(content),
    source_file: filePath,
  }
}

function getPriorWeekRecall(
  db: ReturnType<typeof getDatabase>,
  weekStart: string,
): number | null {
  const prior = db
    .prepare(
      `SELECT must_include_recall_live, must_include_recall_curated
       FROM resolver_weekly_metrics
       WHERE week_start < ?
       ORDER BY week_start DESC
       LIMIT 1`,
    )
    .get(weekStart) as { must_include_recall_live: number | null; must_include_recall_curated: number | null } | undefined
  if (!prior) return null
  return prior.must_include_recall_live ?? prior.must_include_recall_curated ?? null
}

/**
 * Ingest all weekly-*.md files in the audit directory.
 */
export function ingestWeeklyResolverMetrics(options?: {
  db?: ReturnType<typeof getDatabase>
  auditDir?: string
}): WeeklyIngestResult {
  const result: WeeklyIngestResult = { weeksIngested: 0, weeksSkipped: 0, driftAlertsFired: 0, errors: 0 }

  const auditDir = options?.auditDir ?? resolveAuditDir()
  if (!auditDir) {
    logger.warn('resolver-weekly-ingest: no audit dir configured')
    return result
  }

  let files: string[]
  try {
    files = fs.readdirSync(auditDir)
      .filter(f => /^weekly-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => path.join(auditDir, f))
      .sort()
  } catch (err: any) {
    logger.error({ err }, 'resolver-weekly-ingest: cannot read audit dir')
    return result
  }

  if (files.length === 0) {
    logger.info('resolver-weekly-ingest: no weekly files found (first run produces output Sunday 2 AM ET)')
    return result
  }

  const db = options?.db ?? getDatabase()
  ensureResolverTables(db)

  const upsert = db.prepare(`
    INSERT INTO resolver_weekly_metrics
      (week_start, must_include_recall_curated, must_include_recall_live,
       drift_delta_pp, flagged_drift, top_miss_tools, auto_proposed_overrides,
       tokens_saved_total, dollars_saved_total, ingested_at, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(week_start) DO UPDATE SET
      must_include_recall_curated = excluded.must_include_recall_curated,
      must_include_recall_live = excluded.must_include_recall_live,
      drift_delta_pp = excluded.drift_delta_pp,
      flagged_drift = excluded.flagged_drift,
      top_miss_tools = excluded.top_miss_tools,
      auto_proposed_overrides = excluded.auto_proposed_overrides,
      tokens_saved_total = excluded.tokens_saved_total,
      dollars_saved_total = excluded.dollars_saved_total,
      ingested_at = datetime('now'),
      source_file = excluded.source_file
  `)

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const row = parseWeeklyMarkdown(filePath, content)
      if (!row) {
        logger.warn({ filePath }, 'resolver-weekly-ingest: could not parse week_start from file, skipping')
        result.weeksSkipped++
        continue
      }

      const currentRecall = row.must_include_recall_live ?? row.must_include_recall_curated
      const priorRecall = getPriorWeekRecall(db, row.week_start)
      if (currentRecall != null && priorRecall != null) {
        row.drift_delta_pp = (currentRecall - priorRecall) * 100
        row.flagged_drift = Math.abs(row.drift_delta_pp) > 3
      }

      upsert.run(
        row.week_start,
        row.must_include_recall_curated,
        row.must_include_recall_live,
        row.drift_delta_pp,
        row.flagged_drift ? 1 : 0,
        JSON.stringify(row.top_miss_tools),
        JSON.stringify(row.auto_proposed_overrides),
        row.tokens_saved_total,
        row.dollars_saved_total,
        row.source_file,
      )
      result.weeksIngested++

      if (row.flagged_drift) {
        const alreadySent = db
          .prepare('SELECT 1 FROM resolver_drift_alerts_sent WHERE week_start = ?')
          .get(row.week_start)
        if (!alreadySent) {
          try {
            sendDriftAlert({
              weekStart: row.week_start,
              driftDeltaPp: row.drift_delta_pp!,
              topMissTools: row.top_miss_tools.slice(0, 3),
              sourceFile: row.source_file,
            })
            db.prepare('INSERT OR IGNORE INTO resolver_drift_alerts_sent (week_start) VALUES (?)').run(row.week_start)
            result.driftAlertsFired++
          } catch (alertErr: any) {
            logger.error({ alertErr }, 'resolver-weekly-ingest: drift alert failed')
          }
        }
      }
    } catch (err: any) {
      logger.error({ err, filePath }, 'resolver-weekly-ingest: error processing file')
      result.errors++
    }
  }

  return result
}
