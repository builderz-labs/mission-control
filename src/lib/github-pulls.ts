export const REPO_RE = /^[^/]+\/[^/]+$/
export const MAX_REPOS = 8
export const MAX_PRS_PER_REPO = 10

export interface ChatPullRequest {
  repo: string
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  htmlUrl: string
  updatedAt: string
  additions?: number
  deletions?: number
  commits?: number
  user?: string
  kind?: 'pull'
}

export interface PullLike {
  number: number
  title: string
  state: 'open' | 'closed'
  merged?: boolean
  merged_at?: string | null
  html_url: string
  updated_at: string
  additions?: number
  deletions?: number
  commits?: number
  user?: string
}

export function uniqueValidRepos(repos: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const repo of repos) {
    if (!repo || !REPO_RE.test(repo) || seen.has(repo)) continue
    seen.add(repo)
    out.push(repo)
    if (out.length >= MAX_REPOS) break
  }
  return out
}

export function mapPull(repo: string, pr: PullLike): ChatPullRequest {
  const merged = pr.merged === true || Boolean(pr.merged_at)
  return {
    repo,
    number: pr.number,
    title: pr.title,
    state: merged ? 'merged' : pr.state,
    htmlUrl: pr.html_url,
    updatedAt: pr.updated_at,
    additions: pr.additions,
    deletions: pr.deletions,
    commits: pr.commits,
    user: pr.user,
  }
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch {
    return run()
  }
}

export async function collectPullRequests(
  repos: Array<string | null | undefined>,
  fetchPrs: (repo: string) => Promise<PullLike[]>,
): Promise<ChatPullRequest[]> {
  const valid = uniqueValidRepos(repos)
  const out: ChatPullRequest[] = []
  for (const repo of valid) {
    try {
      const prs = await withRetry(() => fetchPrs(repo))
      for (const pr of prs.slice(0, MAX_PRS_PER_REPO)) {
        out.push(mapPull(repo, pr))
      }
    } catch {
      // Skip repos that fail after retry so one bad remote cannot blank the page.
    }
  }
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
