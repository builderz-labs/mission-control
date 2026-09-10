import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { fetchPullRequests, getGitHubToken } from '@/lib/github'
import {
  collectGitHubActivity,
  fetchRepoEvents,
  pullToActivityItem,
  type ChatGitHubItem,
} from '@/lib/github-activity'
import { collectPullRequests, MAX_PRS_PER_REPO, type ChatPullRequest } from '@/lib/github-pulls'
import { logger } from '@/lib/logger'

function emptyFeed() {
  return NextResponse.json({ pullRequests: [], activity: [] })
}

function projectRepos(workspaceId: number): string[] {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT github_repo FROM projects
     WHERE workspace_id = ? AND github_repo IS NOT NULL AND github_repo != ''`,
  ).all(workspaceId) as Array<{ github_repo: string }>
  return rows.map((row) => row.github_repo)
}

async function activityOrPulls(
  repos: string[],
  pullRequests: ChatPullRequest[],
): Promise<ChatGitHubItem[]> {
  try {
    return await collectGitHubActivity(repos, fetchRepoEvents, pullRequests)
  } catch {
    return pullRequests.map(pullToActivityItem)
  }
}

export async function handleGitHubPulls(workspaceId: number) {
  try {
    const token = await getGitHubToken()
    if (!token) return emptyFeed()
    const repos = projectRepos(workspaceId)
    const pullRequests = await collectPullRequests(
      repos,
      (repo) => fetchPullRequests(repo, { state: 'open', per_page: MAX_PRS_PER_REPO }),
    )
    const activity = await activityOrPulls(repos, pullRequests)
    return NextResponse.json({ pullRequests, activity })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/github?action=pulls error')
    return emptyFeed()
  }
}
