import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../github', () => ({
  githubFetch: vi.fn(),
}))

import { githubFetch } from '../github'
import {
  collectGitHubActivity,
  fetchRepoEvents,
  mapGitHubEvent,
  pullToActivityItem,
  type GitHubEventLike,
} from '../github-activity'
import type { ChatPullRequest } from '../github-pulls'

const mockedFetch = vi.mocked(githubFetch)

function prEvent(over: Partial<GitHubEventLike> = {}): GitHubEventLike {
  return {
    id: 'pr1',
    type: 'PullRequestEvent',
    created_at: '2026-09-01T00:00:00Z',
    repo: { name: 'o/r' },
    actor: { login: 'octo' },
    payload: {
      number: 7,
      pull_request: {
        number: 7,
        title: 'Add feed',
        html_url: 'https://github.com/o/r/pull/7',
        state: 'open',
        updated_at: '2026-09-01T12:00:00Z',
        commits: 2,
        additions: 10,
        deletions: 1,
      },
    },
    ...over,
  }
}

function pushEvent(over: Partial<GitHubEventLike> = {}, payload: Record<string, unknown> = {}): GitHubEventLike {
  return {
    id: 'push1',
    type: 'PushEvent',
    created_at: '2026-09-02T00:00:00Z',
    repo: { name: 'o/r' },
    actor: { login: 'octo' },
    payload: {
      ref: 'refs/heads/main',
      size: 2,
      before: 'aaa',
      head: 'bbb',
      commits: [{ message: 'fix lint\nbody' }, { message: 'other' }],
      ...payload,
    },
    ...over,
  }
}

function openPull(over: Partial<ChatPullRequest> = {}): ChatPullRequest {
  return {
    repo: 'o/r',
    number: 9,
    title: 'Open work',
    state: 'open',
    htmlUrl: 'https://github.com/o/r/pull/9',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

describe('mapGitHubEvent', () => {
  it('maps PullRequestEvent fields including stats', () => {
    expect(mapGitHubEvent(prEvent(), 'fallback/r')).toEqual({
      id: 'pull:o/r#7',
      kind: 'pull',
      repo: 'o/r',
      title: 'Add feed',
      htmlUrl: 'https://github.com/o/r/pull/7',
      updatedAt: '2026-09-01T12:00:00Z',
      number: 7,
      state: 'open',
      additions: 10,
      deletions: 1,
      commits: 2,
      actor: 'octo',
    })
  })

  it('treats merged_at as merged and uses the fallback repo', () => {
    const event = prEvent({
      repo: undefined,
      payload: {
        pull_request: {
          number: 3,
          title: 'Done',
          html_url: 'https://github.com/a/b/pull/3',
          state: 'closed',
          merged_at: '2026-09-01T00:00:00Z',
        },
      },
    })
    expect(mapGitHubEvent(event, 'a/b')).toMatchObject({
      id: 'pull:a/b#3',
      kind: 'pull',
      state: 'merged',
      repo: 'a/b',
    })
  })

  it('maps PushEvent to push with first commit message and compare url', () => {
    expect(mapGitHubEvent(pushEvent(), 'o/r')).toMatchObject({
      id: 'push1',
      kind: 'push',
      state: 'push',
      title: 'fix lint',
      commits: 2,
      htmlUrl: 'https://github.com/o/r/compare/aaa...bbb',
      actor: 'octo',
    })
  })

  it('maps a single-commit PushEvent as commit', () => {
    const item = mapGitHubEvent(pushEvent({}, { size: 1, commits: [{ message: 'one' }] }), 'o/r')
    expect(item).toMatchObject({ kind: 'commit', state: 'commit', title: 'one', commits: 1 })
  })

  it('falls back to size and ref when push commits are empty', () => {
    const item = mapGitHubEvent(pushEvent({}, { size: 3, commits: [], before: undefined, head: undefined }), 'o/r')
    expect(item).toMatchObject({
      title: '3 commits to refs/heads/main',
      htmlUrl: 'https://github.com/o/r/commits',
    })
  })

  it('ignores other event types', () => {
    expect(mapGitHubEvent(prEvent({ type: 'WatchEvent' }), 'o/r')).toBeNull()
    expect(mapGitHubEvent(prEvent({ type: 'IssuesEvent' }), 'o/r')).toBeNull()
  })
})

describe('collectGitHubActivity', () => {
  it('retries, skips failures, merges open PRs, sorts, and caps', async () => {
    const fetchEvents = vi.fn(async (repo: string) => {
      if (repo === 'o/bad') throw new Error('boom')
      if (repo === 'o/r') {
        return [pushEvent(), prEvent(), prEvent({ type: 'WatchEvent' })]
      }
      return []
    })
    const items = await collectGitHubActivity(
      ['o/bad', 'bad', 'o/r', 'o/r'],
      fetchEvents,
      [
        openPull(),
        openPull({ number: 7, title: 'dup', updatedAt: '2026-07-01T00:00:00Z' }),
        openPull({ number: 10, title: 'old', updatedAt: '2026-06-01T00:00:00Z' }),
      ],
      3,
    )
    expect(fetchEvents).toHaveBeenCalledTimes(3)
    expect(fetchEvents).toHaveBeenCalledWith('o/r')
    expect(items.map((item) => item.id)).toEqual(['push1', 'pull:o/r#7', 'pull:o/r#9'])
  })

  it('includes open PRs missing from events when fetches fail', async () => {
    const fetchEvents = vi.fn(async () => {
      throw new Error('offline')
    })
    const items = await collectGitHubActivity(['o/r'], fetchEvents, [openPull()])
    expect(fetchEvents).toHaveBeenCalledTimes(2)
    expect(items).toEqual([pullToActivityItem(openPull())])
  })
})

describe('fetchRepoEvents', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })

  it('retries once and uses a safe relative path', async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify([pushEvent()]), { status: 200 }))
    const events = await fetchRepoEvents('o/r')
    expect(events).toHaveLength(1)
    expect(mockedFetch).toHaveBeenCalledWith('/repos/o/r/events?per_page=12')
  })

  it('returns [] after retry failure and for invalid repos', async () => {
    mockedFetch.mockRejectedValue(new Error('offline'))
    await expect(fetchRepoEvents('o/r')).resolves.toEqual([])
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    mockedFetch.mockClear()
    await expect(fetchRepoEvents('https://evil.example/repos')).resolves.toEqual([])
    expect(mockedFetch).not.toHaveBeenCalled()
  })
})
