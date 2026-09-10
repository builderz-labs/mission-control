import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  archiveListedSessions: vi.fn(),
  indexSessionArchives: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(() => ({})) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/session-archive', () => ({ archiveListedSessions: mocks.archiveListedSessions }))
vi.mock('@/lib/session-archive-index', () => ({ indexSessionArchives: mocks.indexSessionArchives }))

import { resetArchiveSchedule, scheduleSessionArchive } from '../session-archive-schedule'

describe('scheduleSessionArchive', () => {
  afterEach(() => {
    resetArchiveSchedule()
    mocks.archiveListedSessions.mockClear()
    mocks.indexSessionArchives.mockClear()
  })

  it('archives once per cooldown window', async () => {
    scheduleSessionArchive([{ id: 'a' }])
    scheduleSessionArchive([{ id: 'b' }])
    await Promise.resolve()
    expect(mocks.archiveListedSessions).toHaveBeenCalledTimes(1)
    expect(mocks.indexSessionArchives).toHaveBeenCalledTimes(1)
  })
})
