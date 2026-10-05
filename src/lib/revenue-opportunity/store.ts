import { randomUUID } from 'node:crypto'
import { getDatabase } from '@/lib/db'
import { evaluateOpportunityEvidenceGate } from './model'
import type { MarketSignalInput, MarketSignalRow, RevenueOpportunityRow } from './types'

export function startScannerRun(workspaceId: number, sources: string[], queryCount: number) {
  const runId = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  getDatabase().prepare(`
    INSERT INTO revenue_scanner_runs (workspace_id, run_id, status, sources, query_count, started_at)
    VALUES (?, ?, 'RUNNING', ?, ?, ?)
  `).run(workspaceId, runId, JSON.stringify(sources), queryCount, now)
  return runId
}

export function finishScannerRun(input: {
  workspaceId: number
  runId: string
  fetchedCount: number
  insertedCount: number
  errors: string[]
}) {
  const status = input.errors.length === 0 ? 'COMPLETED' : input.insertedCount > 0 ? 'PARTIAL' : 'FAILED'
  getDatabase().prepare(`
    UPDATE revenue_scanner_runs
    SET status = ?, fetched_count = ?, inserted_count = ?, error_count = ?, errors = ?,
        completed_at = unixepoch()
    WHERE workspace_id = ? AND run_id = ?
  `).run(
    status, input.fetchedCount, input.insertedCount, input.errors.length, JSON.stringify(input.errors),
    input.workspaceId, input.runId,
  )
  return getDatabase().prepare(`
    SELECT * FROM revenue_scanner_runs WHERE workspace_id = ? AND run_id = ?
  `).get(input.workspaceId, input.runId)
}

export function insertMarketSignal(workspaceId: number, signal: MarketSignalInput): boolean {
  const result = getDatabase().prepare(`
    INSERT OR IGNORE INTO market_signals (
      workspace_id, signal_id, source_id, source_type, source_ref, source_url, title, body_excerpt,
      author, published_at, query_text, portfolio_bucket, domain_hint, pain_terms, content_hash,
      raw_payload, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', unixepoch(), unixepoch())
  `).run(
    workspaceId, signal.signal_id, signal.source_id, signal.source_type, signal.source_ref,
    signal.source_url, signal.title, signal.body_excerpt, signal.author, signal.published_at,
    signal.query_text, signal.portfolio_bucket, signal.domain_hint, JSON.stringify(signal.pain_terms),
    signal.content_hash, JSON.stringify(signal.raw_payload),
  )
  return result.changes > 0
}

export function listMarketSignals(workspaceId: number, limit = 50, status?: string): MarketSignalRow[] {
  const max = Math.max(1, Math.min(500, limit))
  if (status) {
    return getDatabase().prepare(`
      SELECT * FROM market_signals WHERE workspace_id = ? AND status = ?
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(workspaceId, status, max) as MarketSignalRow[]
  }
  return getDatabase().prepare(`
    SELECT * FROM market_signals WHERE workspace_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(workspaceId, max) as MarketSignalRow[]
}

export function listRevenueOpportunities(workspaceId: number, limit = 100): Array<RevenueOpportunityRow & {
  evidence_gate: ReturnType<typeof evaluateOpportunityEvidenceGate>
  evidence_count: number
}> {
  const rows = getDatabase().prepare(`
    SELECT * FROM revenue_opportunities
    WHERE workspace_id = ?
    ORDER BY updated_at DESC, id DESC LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(500, limit))) as RevenueOpportunityRow[]
  return rows.map((row) => {
    const evidence = getDatabase().prepare(`
      SELECT source_type, source_ref FROM opportunity_evidence
      WHERE workspace_id = ? AND opportunity_id = ?
    `).all(workspaceId, row.opportunity_id) as Array<{ source_type: string; source_ref: string }>
    let validation: Record<string, unknown> = {}
    try { validation = JSON.parse(row.validation || '{}') as Record<string, unknown> } catch { validation = {} }
    const uniqueSources = new Set(evidence.map((e) => e.source_type + ':' + e.source_ref)).size
    return {
      ...row,
      evidence_count: evidence.length,
      evidence_gate: evaluateOpportunityEvidenceGate({
        unique_sources: uniqueSources,
        repeated_user_pain: Boolean(validation.repeated_user_pain),
        existing_alternative_verified: Boolean(validation.existing_alternative_verified),
        existing_spend_or_loss_verified: Boolean(validation.existing_spend_or_loss_verified),
        frequency_verified: Boolean(validation.frequency_verified),
        competition_checked: Boolean(validation.competition_checked),
        distribution_path_verified: Boolean(validation.distribution_path_verified),
      }),
    }
  })
}

export function promoteSignalToOpportunity(workspaceId: number, signalId: string, actor = 'local-owner') {
  const signal = getDatabase().prepare(`
    SELECT * FROM market_signals WHERE workspace_id = ? AND signal_id = ? LIMIT 1
  `).get(workspaceId, signalId) as MarketSignalRow | undefined
  if (!signal) throw new Error('Market signal not found')

  if (signal.opportunity_id) {
    return getDatabase().prepare(`
      SELECT * FROM revenue_opportunities WHERE workspace_id = ? AND opportunity_id = ?
    `).get(workspaceId, signal.opportunity_id) as RevenueOpportunityRow
  }

  const opportunityId = 'OPP-' + randomUUID().slice(0, 8).toUpperCase()
  const painTerms = (() => { try { return JSON.parse(signal.pain_terms) as string[] } catch { return [] as string[] } })()
  const pain = signal.body_excerpt.trim() || signal.title
  const fact = {
    claim: 'A public source surfaced this pain/workflow signal.',
    source_type: signal.source_type,
    source_ref: signal.source_ref,
    source_url: signal.source_url,
    title: signal.title,
  }

  const tx = getDatabase().transaction(() => {
    getDatabase().prepare(`
      INSERT INTO revenue_opportunities (
        workspace_id, opportunity_id, title, domain, workflow, pain, status, portfolio_bucket,
        evidence_confidence, facts, assumptions, validation, source_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RESEARCH', ?, 'D', ?, ?, '{}', 1, unixepoch(), unixepoch())
    `).run(
      workspaceId, opportunityId, signal.title.slice(0, 240), signal.domain_hint, signal.query_text,
      pain.slice(0, 2000), signal.portfolio_bucket, JSON.stringify([fact]),
      JSON.stringify([
        { hypothesis: 'This signal may represent a repeated monetizable pain.', status: 'UNVERIFIED' },
        { hypothesis: 'A reachable buyer may be willing to pay for a better solution.', status: 'UNVERIFIED' },
      ]),
    )

    const evidenceId = 'EVID-' + randomUUID().slice(0, 12)
    getDatabase().prepare(`
      INSERT INTO opportunity_evidence (
        workspace_id, evidence_id, opportunity_id, signal_id, kind, source_type, source_ref,
        source_url, claim, confidence, payload, observed_at
      ) VALUES (?, ?, ?, ?, 'FACT', ?, ?, ?, ?, 'D', ?, ?)
    `).run(
      workspaceId, evidenceId, opportunityId, signal.signal_id, signal.source_type, signal.source_ref,
      signal.source_url, signal.title, JSON.stringify({ pain_terms: painTerms, actor }),
      signal.published_at || Math.floor(Date.now() / 1000),
    )

    getDatabase().prepare(`
      UPDATE market_signals SET status = 'PROMOTED', opportunity_id = ?, updated_at = unixepoch()
      WHERE workspace_id = ? AND signal_id = ?
    `).run(opportunityId, workspaceId, signal.signal_id)
  })
  tx()

  return getDatabase().prepare(`
    SELECT * FROM revenue_opportunities WHERE workspace_id = ? AND opportunity_id = ?
  `).get(workspaceId, opportunityId) as RevenueOpportunityRow
}

export function opportunityStoreSummary(workspaceId: number) {
  const db = getDatabase()
  const count = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args) as { count: number }).count)
  const latestRun = db.prepare(`
    SELECT * FROM revenue_scanner_runs WHERE workspace_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(workspaceId) || null
  return {
    signals: count('SELECT COUNT(*) AS count FROM market_signals WHERE workspace_id = ?', workspaceId),
    new_signals: count("SELECT COUNT(*) AS count FROM market_signals WHERE workspace_id = ? AND status = 'NEW'", workspaceId),
    promoted_signals: count("SELECT COUNT(*) AS count FROM market_signals WHERE workspace_id = ? AND status = 'PROMOTED'", workspaceId),
    opportunities: count('SELECT COUNT(*) AS count FROM revenue_opportunities WHERE workspace_id = ?', workspaceId),
    research: count("SELECT COUNT(*) AS count FROM revenue_opportunities WHERE workspace_id = ? AND status = 'RESEARCH'", workspaceId),
    latest_run: latestRun,
  }
}
