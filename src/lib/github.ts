/**
 * GitHub API client for Mission Control issue sync.
 * Uses GITHUB_TOKEN from env (integration key, not core config).
 */

export interface GitHubLabel {
  name: string
  color?: string
}

export interface GitHubUser {
  login: string
  avatar_url?: string
}

export interface GitHubIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: GitHubLabel[]
  assignee: GitHubUser | null
  html_url: string
  created_at: string
  updated_at: string
}

export function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || null
}

/**
 * Authenticated fetch wrapper for GitHub API.
 */
export async function githubFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getGitHubToken()
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured')
  }

  const url = path.startsWith('https://')
    ? path
    : `https://api.github.com${path.startsWith('/') ? '' : '/'}${path}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'MissionControl/1.0',
    ...(options.headers as Record<string, string> || {}),
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch issues from a GitHub repo.
 */
export async function fetchIssues(
  repo: string,
  params?: {
    state?: 'open' | 'closed' | 'all'
    labels?: string
    since?: string
    per_page?: number
    page?: number
  }
): Promise<GitHubIssue[]> {
  const searchParams = new URLSearchParams()
  if (params?.state) searchParams.set('state', params.state)
  if (params?.labels) searchParams.set('labels', params.labels)
  if (params?.since) searchParams.set('since', params.since)
  searchParams.set('per_page', String(params?.per_page ?? 30))
  searchParams.set('page', String(params?.page ?? 1))

  const qs = searchParams.toString()
  const res = await githubFetch(`/repos/${repo}/issues?${qs}`)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  // Filter out pull requests (GitHub API returns PRs in issues endpoint)
  return (data as any[]).filter((item: any) => !item.pull_request)
}

/**
 * Fetch a single issue.
 */
export async function fetchIssue(
  repo: string,
  issueNumber: number
): Promise<GitHubIssue> {
  const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Post a comment on a GitHub issue.
 */
export async function createIssueComment(
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
}

/**
 * Update an issue's state (open/closed).
 */
export async function updateIssueState(
  repo: string,
  issueNumber: number,
  state: 'open' | 'closed'
): Promise<void> {
  const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ state }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
}
