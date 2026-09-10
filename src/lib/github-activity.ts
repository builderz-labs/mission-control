import { githubFetch } from './github'
import { REPO_RE, uniqueValidRepos, type ChatPullRequest } from './github-pulls'

export type GitHubFeedKind = 'pull' | 'push' | 'commit'

export interface ChatGitHubItem {
  id: string
  kind: GitHubFeedKind
  repo: string
  title: string
  htmlUrl: string
  updatedAt: string
  number?: number
  state?: 'open' | 'closed' | 'merged' | 'push' | 'commit'
  additions?: number
  deletions?: number
  commits?: number
  actor?: string
}

export interface GitHubEventLike {
  id: string
  type: string
  created_at: string
  repo?: { name: string }
  actor?: { login: string }
  payload?: Record<string, unknown>
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() } catch { return run() }
}

function prState(pr: Record<string, unknown>): 'open' | 'closed' | 'merged' {
  if (pr.merged === true || Boolean(pr.merged_at)) return 'merged'
  return pr.state === 'closed' ? 'closed' : 'open'
}

function mapPullEvent(event: GitHubEventLike, repo: string, payload: Record<string, unknown>): ChatGitHubItem | null {
  const pr = rec(payload.pull_request)
  const number = num(pr?.number) ?? num(payload.number)
  const title = str(pr?.title)
  const htmlUrl = str(pr?.html_url)
  if (!pr || !number || !title || !htmlUrl) return null
  return {
    id: `pull:${repo}#${number}`, kind: 'pull', repo, title, htmlUrl, number,
    updatedAt: str(pr.updated_at) || event.created_at, state: prState(pr),
    additions: num(pr.additions), deletions: num(pr.deletions),
    commits: num(pr.commits), actor: str(event.actor?.login),
  }
}

function firstCommitMessage(payload: Record<string, unknown>): string | undefined {
  const commits = Array.isArray(payload.commits) ? payload.commits : []
  return str(rec(commits[0])?.message)?.split('\n')[0]
}

function mapPushEvent(event: GitHubEventLike, repo: string, payload: Record<string, unknown>): ChatGitHubItem {
  const size = num(payload.size) ?? (Array.isArray(payload.commits) ? payload.commits.length : 0)
  const kind: GitHubFeedKind = size === 1 ? 'commit' : 'push'
  const before = str(payload.before)
  const head = str(payload.head)
  return {
    id: event.id, kind, repo, state: kind, commits: size, updatedAt: event.created_at,
    title: firstCommitMessage(payload) || `${size} commits to ${str(payload.ref) ?? 'HEAD'}`,
    htmlUrl: before && head
      ? `https://github.com/${repo}/compare/${before}...${head}`
      : `https://github.com/${repo}/commits`,
    actor: str(event.actor?.login),
  }
}

export function mapGitHubEvent(event: GitHubEventLike, fallbackRepo: string): ChatGitHubItem | null {
  const repo = str(event.repo?.name) || fallbackRepo
  const payload = rec(event.payload) ?? {}
  if (event.type === 'PullRequestEvent') return mapPullEvent(event, repo, payload)
  if (event.type === 'PushEvent') return mapPushEvent(event, repo, payload)
  return null
}

export function pullToActivityItem(pr: ChatPullRequest): ChatGitHubItem {
  return {
    id: `pull:${pr.repo}#${pr.number}`, kind: 'pull', repo: pr.repo, title: pr.title,
    htmlUrl: pr.htmlUrl, updatedAt: pr.updatedAt, number: pr.number, state: pr.state,
    additions: pr.additions, deletions: pr.deletions, commits: pr.commits, actor: pr.user,
  }
}

function keepNewer(map: Map<string, ChatGitHubItem>, item: ChatGitHubItem): void {
  const prev = map.get(item.id)
  if (!prev || (Date.parse(item.updatedAt) || 0) >= (Date.parse(prev.updatedAt) || 0)) {
    map.set(item.id, item)
  }
}

function asEvent(item: unknown): GitHubEventLike | null {
  const row = rec(item)
  const id = row && (typeof row.id === 'string' || typeof row.id === 'number') ? String(row.id) : ''
  const type = str(row?.type)
  const createdAt = str(row?.created_at)
  if (!row || !id || !type || !createdAt) return null
  const repoName = str(rec(row.repo)?.name)
  const actor = str(rec(row.actor)?.login)
  return {
    id, type, created_at: createdAt, payload: rec(row.payload),
    ...(repoName ? { repo: { name: repoName } } : {}),
    ...(actor ? { actor: { login: actor } } : {}),
  }
}

async function loadEvents(repo: string): Promise<GitHubEventLike[]> {
  const res = await githubFetch(`/repos/${repo}/events?per_page=12`)
  if (!res.ok) throw new Error(`GitHub events ${res.status}`)
  const data: unknown = await res.json()
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const event = asEvent(entry)
    return event ? [event] : []
  })
}

export async function fetchRepoEvents(repo: string): Promise<GitHubEventLike[]> {
  if (!REPO_RE.test(repo)) return []
  try {
    return await withRetry(() => loadEvents(repo))
  } catch {
    return []
  }
}

export async function collectGitHubActivity(
  repos: Array<string | null | undefined>,
  fetchEvents: (repo: string) => Promise<GitHubEventLike[]>,
  pulls: ChatPullRequest[],
  cap = 24,
): Promise<ChatGitHubItem[]> {
  const items = new Map<string, ChatGitHubItem>()
  for (const repo of uniqueValidRepos(repos)) {
    try {
      const events = await withRetry(() => fetchEvents(repo))
      for (const event of events) {
        const item = mapGitHubEvent(event, repo)
        if (item) keepNewer(items, item)
      }
    } catch { /* skip repo after retry */ }
  }
  for (const pull of pulls) {
    if (pull.state === 'open') keepNewer(items, pullToActivityItem(pull))
  }
  return [...items.values()]
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, cap)
}
