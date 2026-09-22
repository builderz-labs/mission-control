import { describe, expect, it, vi } from 'vitest'
import {
  collectPullRequests,
  mapPull,
  uniqueValidRepos,
} from '../github-pulls'

describe('uniqueValidRepos', () => {
  it('dedupes, drops invalid names, and caps at 8', () => {
    const repos = [
      'owner/one',
      'owner/one',
      'bad',
      null,
      'owner/two',
      'a/b',
      'c/d',
      'e/f',
      'g/h',
      'i/j',
      'k/l',
      'm/n',
    ]
    expect(uniqueValidRepos(repos)).toEqual([
      'owner/one',
      'owner/two',
      'a/b',
      'c/d',
      'e/f',
      'g/h',
      'i/j',
      'k/l',
    ])
  })
})

describe('mapPull', () => {
  it('treats merged_at as merged', () => {
    expect(mapPull('o/r', {
      number: 69,
      title: 'Phase K',
      state: 'open',
      merged_at: '2026-09-01T00:00:00Z',
      html_url: 'https://github.com/o/r/pull/69',
      updated_at: '2026-09-01T00:00:00Z',
    }).state).toBe('merged')
  })

  it('passes through optional commits and user', () => {
    expect(mapPull('o/r', {
      number: 1,
      title: 'Feed',
      state: 'open',
      html_url: 'https://github.com/o/r/pull/1',
      updated_at: '2026-09-01T00:00:00Z',
      commits: 4,
      user: 'octo',
    })).toMatchObject({ commits: 4, user: 'octo' })
  })
})

describe('collectPullRequests', () => {
  it('skips failing repos after retry and sorts by updatedAt', async () => {
    const fetchPrs = vi.fn(async (repo: string) => {
      if (repo === 'o/bad') throw new Error('boom')
      return [{
        number: repo === 'o/new' ? 2 : 1,
        title: repo,
        state: 'open' as const,
        html_url: `https://github.com/${repo}/pull/1`,
        updated_at: repo === 'o/new' ? '2026-09-02T00:00:00Z' : '2026-08-01T00:00:00Z',
      }]
    })

    const pulls = await collectPullRequests(['o/bad', 'o/old', 'o/new'], fetchPrs)
    expect(fetchPrs).toHaveBeenCalledTimes(4)
    expect(pulls.map((p) => p.repo)).toEqual(['o/new', 'o/old'])
  })

  it('returns an empty list when every repo fails', async () => {
    const fetchPrs = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(collectPullRequests(['o/r'], fetchPrs)).resolves.toEqual([])
  })
})
