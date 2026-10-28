import { createHash } from 'node:crypto'
import type { MarketSignalInput, OpportunitySourceState, ScanQuery } from './types'

export const opportunitySourceRegistry: readonly {
  id: string
  name: string
  state: OpportunitySourceState
  role: string
  notes: string
}[] = [
  { id: 'hackernews_algolia', name: 'Hacker News / Algolia', state: 'LIVE_FREE', role: 'tech/business pain and workflow signals', notes: 'Public search API; no paid credential.' },
  { id: 'github_issues', name: 'GitHub Public Issues', state: 'LIVE_FREE', role: 'developer/tooling workflow pain', notes: 'Public Search API with conservative unauthenticated rate use.' },
  { id: 'reddit', name: 'Reddit', state: 'AUTH_REQUIRED', role: 'consumer/business complaints and communities', notes: 'Use official API credentials; no login-bypass scraping.' },
  { id: 'x', name: 'X', state: 'AUTH_REQUIRED', role: 'real-time pain/discussion signals', notes: 'Use authorized API access only.' },
  { id: 'youtube_comments', name: 'YouTube Comments', state: 'AUTH_REQUIRED', role: 'creator/consumer pain language', notes: 'YouTube Data API credential required.' },
  { id: 'app_store_reviews', name: 'App Store / Play Reviews', state: 'MANUAL_OR_EXPORT', role: 'competitor dissatisfaction', notes: 'Targeted official/public review ingestion to be added per app/category.' },
  { id: 'job_postings', name: 'Job Postings', state: 'MANUAL_OR_EXPORT', role: 'existing labor spend / recurring workflow evidence', notes: 'Company/job-board adapters will be added without broad ToS-breaking scraping.' },
  { id: 'saas_reviews', name: 'SaaS Reviews', state: 'MANUAL_OR_EXPORT', role: 'existing spend and switching pain', notes: 'Prefer exports/approved APIs or targeted research.' },
  { id: 'product_hunt', name: 'Product Hunt', state: 'AUTH_REQUIRED', role: 'new solution/competition signals', notes: 'Official API token required.' },
] as const

export const SCAN_QUERIES: readonly ScanQuery[] = [
  { id: 'gravity-manual-workflow', query: 'manual workflow', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY', domain_hint: 'Work / Business', workflow_hint: 'manual operations' },
  { id: 'gravity-spreadsheet-process', query: 'spreadsheet process', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY', domain_hint: 'Work / Business', workflow_hint: 'spreadsheet-heavy operations' },
  { id: 'gravity-customer-support', query: 'customer support repetitive', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY', domain_hint: 'Work / Business', workflow_hint: 'customer support' },
  { id: 'gravity-inventory', query: 'inventory manual', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY', domain_hint: 'Commerce', workflow_hint: 'inventory operations' },
  { id: 'gravity-scheduling', query: 'scheduling frustrating', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY', domain_hint: 'Work / Local', workflow_hint: 'scheduling' },
  { id: 'gravity-reconciliation', query: 'reconciliation manual', portfolio_bucket: 'HIGH_ECONOMIC_GRAVITY', domain_hint: 'Work / Business', workflow_hint: 'reporting / reconciliation' },
  { id: 'adjacent-recruiting', query: 'recruiting workflow', portfolio_bucket: 'ADJACENT', domain_hint: 'HR / Recruiting', workflow_hint: 'recruiting' },
  { id: 'adjacent-app-operations', query: 'app operations tedious', portfolio_bucket: 'ADJACENT', domain_hint: 'Technology', workflow_hint: 'app operations' },
  { id: 'adjacent-marketplace', query: 'marketplace seller pain', portfolio_bucket: 'ADJACENT', domain_hint: 'Commerce', workflow_hint: 'seller operations' },
  { id: 'adjacent-career', query: 'job search repetitive', portfolio_bucket: 'ADJACENT', domain_hint: 'Career', workflow_hint: 'job search' },
  { id: 'explore-property', query: 'property management manual', portfolio_bucket: 'EXPLORATION', domain_hint: 'Property / Local', workflow_hint: 'property operations' },
  { id: 'explore-construction', query: 'construction scheduling', portfolio_bucket: 'EXPLORATION', domain_hint: 'Construction / Local', workflow_hint: 'project scheduling' },
] as const

const PAIN_PATTERNS: readonly [string, RegExp][] = [
  ['manual', /\bmanual(?:ly)?\b/i],
  ['repetitive', /\brepetiti(?:ve|on)|repeat(?:ed|ing)?\b/i],
  ['copy-paste', /copy[ -]?paste/i],
  ['spreadsheet', /spreadsheet|excel|google sheets/i],
  ['expensive', /too expensive|costly|overpriced|pricing/i],
  ['slow', /\bslow|takes? (?:too )?long|time[- ]consuming/i],
  ['frustrating', /frustrat|annoying|painful|tedious/i],
  ['error-prone', /error[- ]prone|mistake|human error/i],
  ['complex', /too complex|complicated|confusing/i],
  ['missing-tool', /wish there (?:was|were)|looking for a tool|no good tool/i],
]

export function detectPainTerms(text: string): string[] {
  return PAIN_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function signalId(sourceId: string, sourceRef: string): string {
  return createHash('sha256').update(sourceId + ':' + sourceRef).digest('hex').slice(0, 24)
}

function contentHash(title: string, body: string): string {
  return createHash('sha256').update(title + '\n' + body).digest('hex')
}

export function selectScanQueries(seed: number, count = 6): ScanQuery[] {
  const high = SCAN_QUERIES.filter((q) => q.portfolio_bucket === 'HIGH_ECONOMIC_GRAVITY')
  const adjacent = SCAN_QUERIES.filter((q) => q.portfolio_bucket === 'ADJACENT')
  const explore = SCAN_QUERIES.filter((q) => q.portfolio_bucket === 'EXPLORATION')
  const rotate = <T,>(items: readonly T[], n: number, offset: number) =>
    Array.from({ length: Math.min(n, items.length) }, (_, i) => items[(i + offset) % items.length])
  const target = Math.max(1, Math.min(12, count))
  const highN = Math.max(1, Math.round(target * 0.5))
  const adjN = Math.max(1, Math.round(target * 0.3))
  const expN = Math.max(1, target - highN - adjN)
  return [
    ...rotate(high, highN, seed % high.length),
    ...rotate(adjacent, adjN, seed % adjacent.length),
    ...rotate(explore, expN, seed % explore.length),
  ].slice(0, target)
}

export function normalizeHnHit(hit: Record<string, unknown>, query: ScanQuery): MarketSignalInput | null {
  const ref = String(hit.objectID || '')
  const title = String(hit.title || hit.story_title || '').trim()
  if (!ref || !title) return null
  const body = stripHtml(String(hit.story_text || hit.comment_text || ''))
  const combined = title + ' ' + body
  return {
    signal_id: signalId('hackernews_algolia', ref),
    source_id: 'hackernews_algolia',
    source_type: 'community_discussion',
    source_ref: ref,
    source_url: String(hit.url || '') || ('https://news.ycombinator.com/item?id=' + ref),
    title,
    body_excerpt: body.slice(0, 1200),
    author: hit.author ? String(hit.author) : null,
    published_at: hit.created_at_i ? Number(hit.created_at_i) : null,
    query_text: query.query,
    portfolio_bucket: query.portfolio_bucket,
    domain_hint: query.domain_hint,
    pain_terms: detectPainTerms(combined),
    content_hash: contentHash(title, body),
    raw_payload: { points: hit.points ?? null, num_comments: hit.num_comments ?? null, workflow_hint: query.workflow_hint },
  }
}

export function normalizeGithubIssue(item: Record<string, unknown>, query: ScanQuery): MarketSignalInput | null {
  const ref = String(item.id || '')
  const title = String(item.title || '').trim()
  if (!ref || !title) return null
  const body = stripHtml(String(item.body || ''))
  const combined = title + ' ' + body
  const user = item.user && typeof item.user === 'object' ? item.user as Record<string, unknown> : {}
  return {
    signal_id: signalId('github_issues', ref),
    source_id: 'github_issues',
    source_type: 'github_issue',
    source_ref: ref,
    source_url: item.html_url ? String(item.html_url) : null,
    title,
    body_excerpt: body.slice(0, 1200),
    author: user.login ? String(user.login) : null,
    published_at: item.created_at ? Math.floor(Date.parse(String(item.created_at)) / 1000) : null,
    query_text: query.query,
    portfolio_bucket: query.portfolio_bucket,
    domain_hint: query.domain_hint,
    pain_terms: detectPainTerms(combined),
    content_hash: contentHash(title, body),
    raw_payload: { comments: item.comments ?? null, state: item.state ?? null, workflow_hint: query.workflow_hint },
  }
}
