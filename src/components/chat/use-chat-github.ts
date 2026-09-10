'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { ChatPullRequest } from '@/lib/github-pulls'

export type ChatGitHubKind = 'pull' | 'push' | 'commit'

export interface ChatGitHubItem {
  id: string
  kind: ChatGitHubKind
  title: string
  repo: string
  htmlUrl?: string
  updatedAt: string | number
  additions?: number
  deletions?: number
  commitCount?: number
}

interface GithubPayload {
  pullRequests?: ChatPullRequest[]
  activity?: unknown
}

function asKind(value: unknown): ChatGitHubKind | null {
  return value === 'pull' || value === 'push' || value === 'commit' ? value : null
}

function asActivity(value: unknown): ChatGitHubItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const rec = item as Record<string, unknown>
    const kind = asKind(rec.kind)
    const title = typeof rec.title === 'string' ? rec.title : null
    const repo = typeof rec.repo === 'string' ? rec.repo : null
    if (!kind || !title || !repo) return []
    return [{
      id: typeof rec.id === 'string' ? rec.id : `${kind}:${repo}:${title}`,
      kind,
      title,
      repo,
      htmlUrl: typeof rec.htmlUrl === 'string' ? rec.htmlUrl : undefined,
      updatedAt: typeof rec.updatedAt === 'string' || typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
      additions: typeof rec.additions === 'number' ? rec.additions : undefined,
      deletions: typeof rec.deletions === 'number' ? rec.deletions : undefined,
      commitCount: typeof rec.commitCount === 'number' ? rec.commitCount
        : typeof rec.commits === 'number' ? rec.commits : undefined,
    }]
  })
}

async function loadGithub(): Promise<GithubPayload> {
  try {
    return await apiFetch<GithubPayload>('/api/github?action=pulls')
  } catch {
    return apiFetch<GithubPayload>('/api/github?action=pulls')
  }
}

export function useChatGithub(): { pullRequests: ChatPullRequest[]; activity: ChatGitHubItem[] } {
  const [pullRequests, setPullRequests] = useState<ChatPullRequest[]>([])
  const [activity, setActivity] = useState<ChatGitHubItem[]>([])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const data = await loadGithub()
        if (cancelled) return
        const pulls = Array.isArray(data.pullRequests) ? data.pullRequests : []
        setPullRequests(pulls)
        setActivity(asActivity(data.activity))
      } catch {
        if (!cancelled) {
          setPullRequests([])
          setActivity([])
        }
      }
    }
    void refresh()
    const id = window.setInterval(() => { void refresh() }, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return { pullRequests, activity }
}
