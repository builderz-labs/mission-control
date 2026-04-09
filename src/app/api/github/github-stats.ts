import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getGitHubToken, githubFetch } from '@/lib/github'

export async function handleGitHubStats(): Promise<NextResponse> {
  const token = getGitHubToken()
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 400 })
  }

  const userRes = await githubFetch('/user')
  if (!userRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch GitHub user' }, { status: 500 })
  }
  const user = await userRes.json() as Record<string, unknown>

  const reposRes = await githubFetch('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator')
  if (!reposRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch repos' }, { status: 500 })
  }
  const allRepos = await reposRes.json() as Array<Record<string, unknown>>

  // Filter: exclude repos that are forks AND where user has never pushed.
  // A fork the user actively commits to will have pushed_at > created_at (by more than a few seconds).
  const activeRepos = allRepos.filter(r => {
    if (!r.fork) return true
    const created = new Date(r.created_at as string).getTime()
    const pushed = new Date(r.pushed_at as string).getTime()
    return (pushed - created) > 60_000
  })

  const langCounts: Record<string, number> = {}
  for (const r of activeRepos) {
    if (r.language) {
      langCounts[r.language as string] = (langCounts[r.language as string] || 0) + 1
    }
  }
  const topLanguages = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }))

  const recentRepos = activeRepos.slice(0, 10).map(r => ({
    name: r.full_name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    open_issues: r.open_issues_count,
    pushed_at: r.pushed_at,
    is_fork: r.fork,
    is_private: r.private,
    html_url: r.html_url,
  }))

  return NextResponse.json({
    user: {
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      public_repos: user.public_repos,
      followers: user.followers,
      following: user.following,
    },
    repos: {
      total: activeRepos.length,
      public: activeRepos.filter(r => !r.private).length,
      private: activeRepos.filter(r => r.private).length,
      total_stars: activeRepos.reduce((sum: number, r) => sum + ((r.stargazers_count as number) || 0), 0),
      total_forks: activeRepos.reduce((sum: number, r) => sum + ((r.forks_count as number) || 0), 0),
      total_open_issues: activeRepos.reduce((sum: number, r) => sum + ((r.open_issues_count as number) || 0), 0),
    },
    topLanguages,
    recentRepos,
  })
}

export function handleStatus(workspaceId: number): NextResponse {
  const db = getDatabase()
  const tableHasWorkspace = db
    .prepare("SELECT 1 as ok FROM pragma_table_info('github_syncs') WHERE name = 'workspace_id'")
    .get() as { ok?: number } | undefined
  const syncs = db.prepare(`
    SELECT id, repo, last_synced_at, issue_count, sync_direction, status, error, created_at, workspace_id FROM github_syncs
    ${tableHasWorkspace?.ok ? 'WHERE workspace_id = ?' : ''}
    ORDER BY created_at DESC
    LIMIT 20
  `).all(...(tableHasWorkspace?.ok ? [workspaceId] : []))

  return NextResponse.json({ syncs })
}
