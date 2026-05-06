/**
 * Hermes Cron/Task Scanner
 *
 * Read-only bridge that discovers Hermes Agent's scheduled cron jobs from:
 * - ~/.hermes/cron/jobs.json — Scheduled task definitions
 * - ~/.hermes/cron/output/{job_id}/ — Execution output files
 *
 * Follows the same throttled-scan pattern as claude-tasks.ts.
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
  runCount: number
}

export interface HermesTaskScanResult {
  cronJobs: HermesCronJob[]
}

function getHermesCronDir(): string {
  return join(config.homeDir, '.hermes', 'cron')
}

function peekLatestOutput(cronDir: string, jobId: string): { lastRunAt: string | null; lastOutput: string | null; runCount: number } {
  const outputDir = join(cronDir, 'output', jobId)
  try {
    if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
      return { lastRunAt: null, lastOutput: null, runCount: 0 }
    }
    const files = readdirSync(outputDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    if (files.length === 0) return { lastRunAt: null, lastOutput: null, runCount: 0 }

    const latestFile = files[0]
    // Filename is typically a timestamp like 2025-01-15T10-30-00.md
    const timestamp = latestFile.replace(/\.md$/, '').replace(/-/g, (m, i) => {
      // Convert filename back to ISO-ish timestamp
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
      runCount: files.length,
    }
  } catch {
    return { lastRunAt: null, lastOutput: null, runCount: 0 }
  }
}

function scanCronJobs(): HermesCronJob[] {
  const cronDir = getHermesCronDir()
  const jobsFile = join(cronDir, 'jobs.json')

  if (!existsSync(jobsFile)) return []

  try {
    const raw = readFileSync(jobsFile, 'utf-8')
    const jobs = JSON.parse(raw)

    if (!Array.isArray(jobs)) return []

    return jobs.map((job: any) => {
      const id = job.id || job.name || 'unknown'
      const { lastRunAt, lastOutput, runCount } = peekLatestOutput(cronDir, id)

      return {
        id,
        prompt: job.prompt || job.command || job.description || '',
        schedule: job.schedule || job.cron || job.interval || '',
        enabled: job.enabled !== false,
        lastRunAt: job.last_run_at || lastRunAt,
        lastOutput,
        createdAt: job.created_at || null,
        runCount: runCount ?? 0,
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to parse Hermes cron jobs')
    return []
  }
}

// Throttle full disk scans
let lastScanAt = 0
let cachedResult: HermesTaskScanResult = { cronJobs: [] }
const SCAN_THROTTLE_MS = 30_000

export function getHermesTasks(force = false): HermesTaskScanResult {
  const now = Date.now()
  if (!force && lastScanAt > 0 && (now - lastScanAt) < SCAN_THROTTLE_MS) {
    return cachedResult
  }

  try {
    cachedResult = { cronJobs: scanCronJobs() }
    lastScanAt = now
  } catch (err) {
    logger.warn({ err }, 'Hermes task scan failed')
  }

  return cachedResult
}
