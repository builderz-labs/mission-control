import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface LaunchdCronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
  agentId?: string
  timezone?: string
  model?: string
  delivery?: string
}

interface LaunchdCronOptions {
  homeDir?: string
  holyhedgehogRoot?: string
  stockNewsRunsPath?: string
  now?: Date
}

interface JobTiming {
  hour: number
  minute: number
}

const KST_TZ = 'Asia/Seoul'
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const LEGACY_SHADOW_NAMES = new Set([
  'Daily US Stock News',
  'Holy Hedgehog - Daily Prepare',
  'Holy Hedgehog - Autoresearch 5AM',
  'Holy Hedgehog - Follow-up 2PM',
  'Holy Hedgehog - Follow-up 5PM',
  'Holy Hedgehog - Follow-up 8PM',
])

const FOLLOWUP_TIMINGS: Array<JobTiming & { id: string; name: string; logFile: string }> = [
  { id: 'launchd-hh-followup-0930', name: 'Holy Hedgehog - Follow-up 9:30AM', hour: 9, minute: 30, logFile: 'cron-followups.log' },
  { id: 'launchd-hh-followup-1230', name: 'Holy Hedgehog - Follow-up 12:30PM', hour: 12, minute: 30, logFile: 'cron-followups.log' },
  { id: 'launchd-hh-followup-1400', name: 'Holy Hedgehog - Follow-up 2PM', hour: 14, minute: 0, logFile: 'cron-2pm.log' },
  { id: 'launchd-hh-followup-1700', name: 'Holy Hedgehog - Follow-up 5PM', hour: 17, minute: 0, logFile: 'cron-5pm.log' },
  { id: 'launchd-hh-followup-2000', name: 'Holy Hedgehog - Follow-up 8PM', hour: 20, minute: 0, logFile: 'cron-8pm.log' },
]

function readJsonFile(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function latestFile(dirPath: string, matcher: RegExp): string | null {
  try {
    const candidates = fs.readdirSync(dirPath)
      .filter((name) => matcher.test(name))
      .map((name) => {
        const absolute = path.join(dirPath, name)
        return { absolute, mtimeMs: fs.statSync(absolute).mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    return candidates[0]?.absolute || null
  } catch {
    return null
  }
}

function lastJsonlObject(filePath: string): Record<string, unknown> | null {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]!)
      } catch {
        continue
      }
    }
  } catch {
    return null
  }
  return null
}

function toKstDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS)
  return shifted.toISOString().slice(0, 10)
}

function withKstTime(dateKey: string, hour: number, minute = 0): Date {
  const base = new Date(`${dateKey}T00:00:00+09:00`)
  return new Date(base.getTime() + ((hour * 60) + minute) * 60 * 1000)
}

function nextRunAt(now: Date, timing: JobTiming): number {
  const todayKey = toKstDateKey(now)
  let candidate = withKstTime(todayKey, timing.hour, timing.minute)
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = new Date(candidate.getTime() + 24 * 60 * 60 * 1000)
    candidate = tomorrow
  }
  return candidate.getTime()
}

function fileMtimeMs(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return undefined
  }
}

function getHhStatus(paths: { holyhedgehogRoot: string; now: Date }) {
  if (!paths.holyhedgehogRoot) return null
  const plansDir = path.join(paths.holyhedgehogRoot, 'content', 'plans')
  const todayKey = toKstDateKey(paths.now)
  const todaysFile = path.join(plansDir, `hh-daily-status-${todayKey}.json`)
  const fallbackFile = latestFile(plansDir, /^hh-daily-status-\d{4}-\d{2}-\d{2}\.json$/)
  const filePath = fs.existsSync(todaysFile) ? todaysFile : fallbackFile
  if (!filePath) return null
  const payload = readJsonFile(filePath)
  if (!payload) return null
  return {
    filePath,
    stat: fs.statSync(filePath),
    payload,
  }
}

function parseLogStatus(logPath: string): { lastRun?: number; lastStatus?: 'success' | 'error'; lastError?: string } {
  if (!fs.existsSync(logPath)) return {}
  try {
    const stat = fs.statSync(logPath)
    const content = fs.readFileSync(logPath, 'utf8')
    const tail = content.slice(Math.max(0, content.length - 6000)).toLowerCase()
    const looksError =
      tail.includes('traceback') ||
      tail.includes('error:') ||
      tail.includes('failed') ||
      tail.includes('exception')
    return {
      lastRun: stat.mtimeMs,
      lastStatus: looksError ? 'error' : 'success',
    }
  } catch {
    return {}
  }
}

function logsDir(holyhedgehogRoot: string): string {
  return holyhedgehogRoot ? path.join(holyhedgehogRoot, 'logs') : ''
}

function homeDir(options: LaunchdCronOptions): string {
  return options.homeDir || os.homedir()
}

function launchAgentsDir(options: LaunchdCronOptions): string {
  return path.join(homeDir(options), 'Library', 'LaunchAgents')
}

function hasLaunchAgent(options: LaunchdCronOptions, fileName: string): boolean {
  return fs.existsSync(path.join(launchAgentsDir(options), fileName))
}

export function getLegacyShadowNames(): string[] {
  return Array.from(LEGACY_SHADOW_NAMES)
}

export function getLaunchdManagedCronJobs(options: LaunchdCronOptions = {}): LaunchdCronJob[] {
  const now = options.now || new Date()
  const hhRoot = options.holyhedgehogRoot || ''
  const status = getHhStatus({ holyhedgehogRoot: hhRoot, now })
  const currentLogsDir = logsDir(hhRoot)
  const jobs: LaunchdCronJob[] = []

  if (hasLaunchAgent(options, 'ai.openclaw.hh-prepare-daily.plist')) {
    const published = Number(status?.payload?.published || 0)
    const reserved = Number(status?.payload?.future_reserved_today || 0)
    const failures = Array.isArray(status?.payload?.prepare_failures) ? status!.payload.prepare_failures.map(String) : []
    jobs.push({
      id: 'launchd-hh-prepare-daily',
      name: 'Holy Hedgehog - Daily Prepare',
      schedule: '0 1 * * * (Asia/Seoul)',
      command: '/Users/j2w/.openclaw/bin/hh_prepare_daily.sh',
      enabled: true,
      lastRun: status ? Math.floor(status.stat.mtimeMs) : fileMtimeMs(path.join(currentLogsDir, 'cron-daily.log')),
      nextRun: nextRunAt(now, { hour: 1, minute: 0 }),
      lastStatus: failures.length > 0 ? 'error' : ((published + reserved) > 0 || status?.payload?.prepare_ran ? 'success' : undefined),
      lastError: failures.length > 0 ? failures.join(', ') : undefined,
      agentId: 'system',
      timezone: KST_TZ,
      delivery: 'launchd',
    })
  }

  if (hasLaunchAgent(options, 'ai.openclaw.hh-autoresearch.plist')) {
    const logPath = path.join(currentLogsDir, 'hh-autoresearch.log')
    const logState = parseLogStatus(logPath)
    jobs.push({
      id: 'launchd-hh-autoresearch',
      name: 'Holy Hedgehog - Autoresearch 5AM',
      schedule: '0 5 * * * (Asia/Seoul)',
      command: '/Users/j2w/.openclaw/bin/hh_autoresearch.sh',
      enabled: true,
      lastRun: logState.lastRun,
      nextRun: nextRunAt(now, { hour: 5, minute: 0 }),
      lastStatus: logState.lastStatus,
      lastError: logState.lastError,
      agentId: 'system',
      timezone: KST_TZ,
      delivery: 'launchd',
    })
  }

  if (hasLaunchAgent(options, 'ai.openclaw.hh-publish-followups.plist')) {
    for (const followup of FOLLOWUP_TIMINGS) {
      const logState = parseLogStatus(path.join(currentLogsDir, followup.logFile))
      jobs.push({
        id: followup.id,
        name: followup.name,
        schedule: `${followup.minute} ${followup.hour} * * * (Asia/Seoul)`,
        command: '/Users/j2w/.openclaw/bin/hh_publish_followup.sh',
        enabled: true,
        lastRun: logState.lastRun,
        nextRun: nextRunAt(now, { hour: followup.hour, minute: followup.minute }),
        lastStatus: logState.lastStatus,
        lastError: logState.lastError,
        agentId: 'system',
        timezone: KST_TZ,
        delivery: 'launchd',
      })
    }
  }

  if (hasLaunchAgent(options, 'ai.openclaw.daily-us-stock-news.plist')) {
    const latestRun = options.stockNewsRunsPath ? lastJsonlObject(options.stockNewsRunsPath) : null
    const latestRunAt = typeof latestRun?.run_at === 'string' ? new Date(latestRun.run_at).getTime() : undefined
    const sendSuccess = Boolean(latestRun?.send_success)
    const runError = typeof latestRun?.error === 'string' ? latestRun.error : undefined
    jobs.push({
      id: 'launchd-daily-us-stock-news',
      name: 'Daily US Stock News',
      schedule: '0 15 * * * (Asia/Seoul)',
      command: '/Users/j2w/.openclaw/bin/daily_us_stock_news.sh',
      enabled: true,
      lastRun: latestRunAt,
      nextRun: nextRunAt(now, { hour: 15, minute: 0 }),
      lastStatus: latestRunAt ? (sendSuccess ? 'success' : 'error') : undefined,
      lastError: runError,
      agentId: 'main',
      timezone: KST_TZ,
      delivery: 'launchd',
    })
  }

  return jobs
}
