/**
 * GitHub API client for Mission Control issue sync.
 * Resolves GITHUB_TOKEN from the OpenClaw integration env file first,
 * then falls back to process.env for deployments that export it directly.
 */
import { getEffectiveEnvValue } from '@/lib/runtime-env'

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

export async function getGitHubToken(): Promise<string | null> {
  return await getEffectiveEnvValue('GITHUB_TOKEN') || null
}

/**
 * Authenticated fetch wrapper for GitHub API.
 */
export async function githubFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getGitHubToken()
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

/**
 * Update an issue (title, body, state, labels, assignees).
 */
export async function updateIssue(
  repo: string,
  issueNumber: number,
  updates: {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    labels?: string[]
    assignees?: string[]
  }
): Promise<GitHubIssue> {
  const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Create a new issue on GitHub.
 */
export async function createIssue(
  repo: string,
  issue: {
    title: string
    body?: string
    labels?: string[]
    assignees?: string[]
  }
): Promise<GitHubIssue> {
  const res = await githubFetch(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify(issue),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Create a label on a GitHub repo (ignores 422 = already exists).
 */
export async function createLabel(
  repo: string,
  label: { name: string; color: string; description?: string }
): Promise<void> {
  const res = await githubFetch(`/repos/${repo}/labels`, {
    method: 'POST',
    body: JSON.stringify(label),
  })
  // 422 = label already exists, that's fine
  if (!res.ok && res.status !== 422) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
}

/**
 * Idempotently ensure all specified labels exist on the repo.
 */
export async function ensureLabels(
  repo: string,
  labels: Array<{ name: string; color: string; description?: string }>
): Promise<void> {
  for (const label of labels) {
    await createLabel(repo, label)
  }
}

/**
 * Set the labels on an issue (replaces all existing labels).
 */
export async function updateIssueLabels(
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const res = await githubFetch(`/repos/${repo}/issues/${issueNumber}/labels`, {
    method: 'PUT',
    body: JSON.stringify({ labels }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
}

/**
 * Create a git ref (branch).
 */
export async function createRef(
  repo: string,
  ref: string,
  sha: string
): Promise<void> {
  const res = await githubFetch(`/repos/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref, sha }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
}

/**
 * Get a git ref SHA.
 */
export async function getRef(
  repo: string,
  ref: string
): Promise<{ sha: string }> {
  const res = await githubFetch(`/repos/${repo}/git/refs/${ref}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  const data = await res.json() as { object: { sha: string } }
  return { sha: data.object.sha }
}

export interface GitHubPullRequest {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  merged: boolean
  head: { ref: string; sha: string }
  base: { ref: string }
  html_url: string
  created_at: string
  updated_at: string
}

/**
 * Fetch pull requests from a GitHub repo.
 */
export async function fetchPullRequests(
  repo: string,
  params?: {
    head?: string
    state?: 'open' | 'closed' | 'all'
    per_page?: number
  }
): Promise<GitHubPullRequest[]> {
  const searchParams = new URLSearchParams()
  if (params?.head) searchParams.set('head', params.head)
  if (params?.state) searchParams.set('state', params.state)
  searchParams.set('per_page', String(params?.per_page ?? 30))

  const qs = searchParams.toString()
  const res = await githubFetch(`/repos/${repo}/pulls?${qs}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Create a pull request.
 */
export async function createPullRequest(
  repo: string,
  pr: {
    title: string
    head: string
    base: string
    body?: string
  }
): Promise<GitHubPullRequest> {
  const res = await githubFetch(`/repos/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify(pr),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  return res.json()
}
