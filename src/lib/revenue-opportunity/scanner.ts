import { opportunitySourceRegistry, normalizeGithubIssue, normalizeHnHit, selectScanQueries } from './sources'
import { finishScannerRun, insertMarketSignal, startScannerRun } from './store'
import type { MarketSignalInput, ScanQuery } from './types'

const USER_AGENT = 'AI-Control-Tower-Opportunity-Scanner/0.1'
const REQUEST_TIMEOUT_MS = 8_000

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<Record<string, unknown>>
}

async function scanHackerNews(query: ScanQuery, limit: number): Promise<MarketSignalInput[]> {
  const url = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=' + limit + '&query=' + encodeURIComponent(query.query)
  const payload = await fetchJson(url)
  const hits = Array.isArray(payload.hits) ? payload.hits as Record<string, unknown>[] : []
  return hits.map((hit) => normalizeHnHit(hit, query)).filter((x): x is MarketSignalInput => Boolean(x))
}

async function scanGithubIssues(query: ScanQuery, limit: number): Promise<MarketSignalInput[]> {
  const q = '"' + query.query + '" is:issue is:open'
  const url = 'https://api.github.com/search/issues?sort=updated&order=desc&per_page=' + limit + '&q=' + encodeURIComponent(q)
  const payload = await fetchJson(url, { Accept: 'application/vnd.github+json' })
  const items = Array.isArray(payload.items) ? payload.items as Record<string, unknown>[] : []
  return items.map((item) => normalizeGithubIssue(item, query)).filter((x): x is MarketSignalInput => Boolean(x))
}

export async function runMarketScanner(workspaceId: number, options: {
  queryCount?: number
  perQuery?: number
  sources?: string[]
  seed?: number
} = {}) {
  const queryCount = Math.max(1, Math.min(12, options.queryCount ?? 6))
  const perQuery = Math.max(1, Math.min(10, options.perQuery ?? 4))
  const seed = options.seed ?? Math.floor(Date.now() / 86_400_000)
  const queries = selectScanQueries(seed, queryCount)
  const requested = options.sources?.length ? options.sources : ['hackernews_algolia', 'github_issues']
  const liveIds = new Set(opportunitySourceRegistry.filter((s) => s.state === 'LIVE_FREE').map((s) => s.id))
  const sources = requested.filter((id) => liveIds.has(id))
  if (sources.length === 0) throw new Error('No LIVE_FREE source selected')

  const runId = startScannerRun(workspaceId, sources, queries.length)
  let fetchedCount = 0
  let insertedCount = 0
  const errors: string[] = []

  for (const source of sources) {
    const sourceQueries = source === 'github_issues' ? queries.slice(0, Math.min(3, queries.length)) : queries
    for (const query of sourceQueries) {
      try {
        const signals = source === 'hackernews_algolia'
          ? await scanHackerNews(query, perQuery)
          : await scanGithubIssues(query, perQuery)
        fetchedCount += signals.length
        for (const signal of signals) {
          if (insertMarketSignal(workspaceId, signal)) insertedCount += 1
        }
      } catch (error) {
        errors.push(source + ':' + query.id + ':' + (error instanceof Error ? error.message : String(error)))
      }
      if (source === 'github_issues') await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  const run = finishScannerRun({ workspaceId, runId, fetchedCount, insertedCount, errors })
  return { run, queries, sources, fetched_count: fetchedCount, inserted_count: insertedCount, errors }
}
