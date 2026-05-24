/**
 * Background poller for GitHub ↔ MC task sync.
 * Lazy singleton — call startSyncPoller() to begin.
 */

import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { pullFromGitHub } from '@/lib/github-sync-engine'

const INTERVAL_MS = parseInt(process.env.GITHUB_SYNC_INTERVAL_MS || '60000', 10)

let intervalHandle: ReturnType<typeof setInterval> | null = null
let lastRun: number | undefined

function startSyncPoller(): void {
  if (intervalHandle) return

  logger.info({ intervalMs: INTERVAL_MS }, 'Starting GitHub sync poller')

  intervalHandle = setInterval(async () => {
    await runSyncTick()
  }, INTERVAL_MS)

  // Run immediately on start
  runSyncTick().catch(() => {})
}

function stopSyncPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    logger.info('GitHub sync poller stopped')
  }
}

export function getSyncPollerStatus(): { running: boolean; interval: number; lastRun?: number } {
  return {
    running: intervalHandle !== null,
    interval: INTERVAL_MS,
    lastRun,
  }
}

async function runSyncTick(): Promise<void> {
  try {
    const db = getDatabase()

    const projects = db.prepare(`
      SELECT id, github_repo, github_sync_enabled, github_default_branch, workspace_id
      FROM projects
      WHERE github_sync_enabled = 1 AND github_repo IS NOT NULL AND status = 'active'
    `).all() as Array<{
      id: number
      github_repo: string
      github_sync_enabled: number
      github_default_branch: string | null
      workspace_id: number
    }>

    await Promise.allSettled(
      projects.map(async (project) => {
        try {
          await pullFromGitHub(project, project.workspace_id)
        } catch (err) {
          logger.error({ err, projectId: project.id, repo: project.github_repo }, 'Sync poller: project sync failed')
        }
      })
    )

    lastRun = Math.floor(Date.now() / 1000)
  } catch (err) {
    logger.error({ err }, 'Sync poller tick failed')
  }
}
