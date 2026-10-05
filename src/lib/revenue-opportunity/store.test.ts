import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { insertMarketSignal, listMarketSignals, listRevenueOpportunities, promoteSignalToOpportunity } from './store'

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE market_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, signal_id TEXT NOT NULL,
      source_id TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT NOT NULL, source_url TEXT,
      title TEXT NOT NULL, body_excerpt TEXT NOT NULL DEFAULT '', author TEXT, published_at INTEGER,
      query_text TEXT, portfolio_bucket TEXT NOT NULL, domain_hint TEXT, pain_terms TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL, raw_payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'NEW',
      opportunity_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(workspace_id, signal_id), UNIQUE(workspace_id, source_id, source_ref)
    );
    CREATE TABLE revenue_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, opportunity_id TEXT NOT NULL,
      title TEXT NOT NULL, domain TEXT, workflow TEXT, pain TEXT NOT NULL, target_user TEXT, buyer TEXT,
      status TEXT NOT NULL DEFAULT 'DISCOVERED', portfolio_bucket TEXT NOT NULL, evidence_confidence TEXT NOT NULL DEFAULT 'D',
      judge_decision TEXT, primary_payment_trigger TEXT, scores TEXT NOT NULL DEFAULT '{}', founder_advantage TEXT NOT NULL DEFAULT '{}',
      facts TEXT NOT NULL DEFAULT '[]', inferences TEXT NOT NULL DEFAULT '[]', assumptions TEXT NOT NULL DEFAULT '[]',
      validation TEXT NOT NULL DEFAULT '{}', source_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(workspace_id, opportunity_id)
    );
    CREATE TABLE opportunity_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, evidence_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL, signal_id TEXT, kind TEXT NOT NULL, source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL, source_url TEXT, claim TEXT NOT NULL, confidence TEXT, payload TEXT NOT NULL DEFAULT '{}',
      observed_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(workspace_id, evidence_id)
    );
  `)
})
afterEach(() => db.close())

const signal = {
  signal_id: 'sig-1', source_id: 'hackernews_algolia', source_type: 'community_discussion',
  source_ref: '123', source_url: 'https://example.com/123', title: 'Manual support workflow is painful',
  body_excerpt: 'We copy paste the same answers every day.', author: 'u', published_at: 100,
  query_text: 'customer support repetitive', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY' as const,
  domain_hint: 'Work / Business', pain_terms: ['manual','copy-paste'], content_hash: 'hash-1', raw_payload: {},
}

describe('opportunity store', () => {
  it('deduplicates raw market signals', () => {
    expect(insertMarketSignal(1, signal)).toBe(true)
    expect(insertMarketSignal(1, signal)).toBe(false)
    expect(listMarketSignals(1)).toHaveLength(1)
  })

  it('promotes a signal to research without pretending the evidence gate passed', () => {
    insertMarketSignal(1, signal)
    const opportunity = promoteSignalToOpportunity(1, 'sig-1')
    expect(opportunity.status).toBe('RESEARCH')
    const listed = listRevenueOpportunities(1)
    expect(listed).toHaveLength(1)
    expect(listed[0].evidence_count).toBe(1)
    expect(listed[0].evidence_gate.pass).toBe(false)
    expect(listed[0].evidence_gate.missing).toContain('unique_sources>=3')
  })
})
