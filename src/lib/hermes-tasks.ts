/**
 * Hermes Cron/Task Scanner
 *
 * Read-only bridge that discovers Hermes Agent's scheduled cron jobs from:
 * - ~/.hermes/cron/jobs.json — Scheduled task definitions
 * - ~/.hermes/cron/output/{job_id}/ — Execution output files
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config'
import { logger } from './logger'

export interface HermesCronJob {
  id: string
  prompt: string
  schedule: string
  enabled: boolean
  lastRunAt: string | null
  lastOutput: string | null
  createdAt: string | null
  profile?: string
}

export interface HermesTaskScanResult {
  cronJobs: HermesCronJob[]
}

function getHermesCronDir(profile?: string): string {
  if (profile && profile !== 'default') {
    return join(config.homeDir, '.hermes', 'profiles', profile, 'cron')
  }
  return join(config.homeDir, '.hermes', 'cron')
}

function peekLatestOutput(cronDir: string, jobId: string): { lastRunAt: string | null; lastOutput: string | null } {
  const outputDir = join(cronDir, 'output', jobId)
  try {
    if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
      return { lastRunAt: null, lastOutput: null }
    }
    const files = readdirSync(outputDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    if (files.length === 0) return { lastRunAt: null, lastOutput: null }

    const latestFile = files[0]
    const timestamp = latestFile.replace(/\.md$/, '').replace(/-/g, (m, i) => {
      return i > 9 ? ':' : m
    })

    const filePath = join(outputDir, latestFile)
    let content: string | null = null
    try {
      const raw = readFileSync(filePath, 'utf-8')
      content = raw.slice(0, 500)
    } catch { /* ignore */ }

    return {
      lastRunAt: timestamp || null,
      lastOutput: content,
    }
  } catch {
    return { lastRunAt: null, lastOutput: null }
  }
}

function scanCronJobs(profile?: string): HermesCronJob[] {
  const cronDir = getHermesCronDir(profile)
  const jobsFile = join(cronDir, 'jobs.json')

  if (!existsSync(jobsFile)) return []

  try {
    const raw = readFileSync(jobsFile, 'utf-8')
    const data = JSON.parse(raw)

    // Handle both direct array and { jobs: [] } object format
    const jobs = Array.isArray(data) ? data : (data?.jobs || [])

    if (!Array.isArray(jobs)) return []

    return jobs.map((job: any) => {
      const id = job.id || job.name || 'unknown'
      const { lastRunAt, lastOutput } = peekLatestOutput(cronDir, id)

      // Extract schedule string from object or string
      let scheduleStr = job.schedule || job.cron || job.interval || ''
      if (typeof scheduleStr === 'object' && scheduleStr !== null) {
        scheduleStr = scheduleStr.display || scheduleStr.expr || JSON.stringify(scheduleStr)
      }

      return {
        id,
        prompt: job.prompt || job.command || job.description || '',
        schedule: scheduleStr,
        enabled: job.enabled !== false,
        lastRunAt: job.last_run_at || lastRunAt,
        lastOutput,
        createdAt: job.created_at || null,
        profile: profile || 'default',
      }
    })
  } catch (err) {
    logger.warn({ err, profile }, 'Failed to parse Hermes cron jobs')
    return []
  }
}

export function getHermesTasks(force = false, profile?: string): HermesTaskScanResult {
  const profileKey = profile || 'default'
  try {
    const cronJobs = scanCronJobs(profile)
    console.log(`[Hermes Task Sync] Found ${cronJobs.length} jobs for profile: ${profileKey}`);
    return { cronJobs }
  } catch (err) {
    logger.warn({ err, profile }, 'Hermes task scan failed')
    return { cronJobs: [] }
  }
}
