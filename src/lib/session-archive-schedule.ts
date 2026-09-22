import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { archiveListedSessions } from '@/lib/session-archive'
import { indexSessionArchives } from '@/lib/session-archive-index'

export const ARCHIVE_COOLDOWN_MS = 120_000

let lastArchiveAt = 0

export function scheduleSessionArchive(sessions: Array<Record<string, unknown>>): void {
  const now = Date.now()
  if (now - lastArchiveAt < ARCHIVE_COOLDOWN_MS) return
  lastArchiveAt = now
  queueMicrotask(() => {
    try {
      archiveListedSessions(sessions)
      indexSessionArchives(getDatabase(), sessions)
    } catch (err) {
      logger.warn({ err }, 'Session archive skipped')
    }
  })
}

export function resetArchiveSchedule(): void {
  lastArchiveAt = 0
}
