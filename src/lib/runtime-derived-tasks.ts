import fs from 'node:fs'
import path from 'node:path'
import type { Task } from '@/lib/db'
import { config } from '@/lib/config'

type RuntimeTaskStatus = Task['status'] | 'awaiting_owner'
type RuntimeTaskPriority = Task['priority'] | 'critical'
type DerivedTask = Omit<Task, 'status' | 'priority' | 'tags' | 'metadata'> & {
  status: RuntimeTaskStatus
  priority: RuntimeTaskPriority
  tags: string[]
  metadata: Record<string, unknown>
}

interface RuntimeTaskOptions {
  now?: Date
  holyhedgehogRoot?: string
  bizReportsDir?: string
  stockNewsRunsPath?: string
}

interface DailyNewsRun {
  run_at?: string
  send_success?: boolean
  dry_run?: boolean
  article_count?: number
  chunk_count?: number
  error?: string
}

interface RuntimePaths {
  holyhedgehogRoot: string
  bizReportsDir: string
  stockNewsRunsPath: string
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const HH_AGENT = 'hh-ops'
const NEWS_AGENT = 'news-ops'
const GROWTH_AGENT = 'growth-ops'
const BIZ_AGENT = 'biz-ops'

function runtimePaths(options: RuntimeTaskOptions = {}): RuntimePaths {
  return {
    holyhedgehogRoot: options.holyhedgehogRoot ?? config.holyhedgehogRoot ?? '',
    bizReportsDir: options.bizReportsDir ?? config.bizReportsDir ?? '',
    stockNewsRunsPath: options.stockNewsRunsPath ?? config.stockNewsRunsPath ?? '',
  }
}

function toKstDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS)
  return shifted.toISOString().slice(0, 10)
}

function withKstTime(dateKey: string, hour: number, minute = 0): Date {
  const base = new Date(`${dateKey}T00:00:00+09:00`)
  return new Date(base.getTime() + ((hour * 60) + minute) * 60 * 1000)
}

function readJsonFile(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function formatSlots(slots: unknown): string {
  if (!Array.isArray(slots) || slots.length === 0) return 'none'
  return slots.map((slot) => String(slot).replace('T', ' ').replace('+09:00', ' KST')).join(', ')
}

function latestGrowthResult(uploadDir: string, platform: 'youtube' | 'x'): Record<string, unknown> | null {
  const latest = latestFile(uploadDir, new RegExp(`-${platform}-page-agent-result\\.json$`))
  return latest ? readJsonFile(latest) : null
}

function latestGrowthUploadPackage(uploadDir: string, platform: 'youtube' | 'x'): Record<string, unknown> | null {
  const latest = latestFile(uploadDir, new RegExp(`-${platform}-upload\\.json$`))
  return latest ? readJsonFile(latest) : null
}

function toDerivedTask(base: {
  id: number
  title: string
  description: string
  status: DerivedTask['status']
  priority: DerivedTask['priority']
  assignedTo: string
  createdAt: number
  updatedAt: number
  tags?: string[]
  metadata?: Record<string, unknown>
}): DerivedTask {
  return {
    id: base.id,
    title: base.title,
    description: base.description,
    status: base.status,
    priority: base.priority,
    assigned_to: base.assignedTo,
    created_by: 'runtime-sync',
    created_at: base.createdAt,
    updated_at: base.updatedAt,
    tags: base.tags || [],
    metadata: {
      runtimeDerived: true,
      readOnly: true,
      ...base.metadata,
    },
  } as DerivedTask
}

function deriveHhTask(paths: RuntimePaths, now: Date): DerivedTask | null {
  const plansDir = paths.holyhedgehogRoot ? path.join(paths.holyhedgehogRoot, 'content', 'plans') : ''
  const dateKey = toKstDateKey(now)
  const todaysFile = plansDir ? path.join(plansDir, `hh-daily-status-${dateKey}.json`) : ''
  const fallbackFile = plansDir ? latestFile(plansDir, /^hh-daily-status-\d{4}-\d{2}-\d{2}\.json$/) : null
  const filePath = (todaysFile && fs.existsSync(todaysFile)) ? todaysFile : fallbackFile
  if (!filePath) return null

  const payload = readJsonFile(filePath)
  if (!payload) return null

  const stat = fs.statSync(filePath)
  const reserved = Number(payload.future_reserved_today || 0)
  const published = Number(payload.published || 0)
  const quotaTarget = Math.max(1, Number(payload.daily_count || 3))
  const completed = published + reserved
  const availableSlots = Array.isArray(payload.available_slots) ? payload.available_slots : []
  const failures = Array.isArray(payload.prepare_failures) ? payload.prepare_failures : []
  const failureCounts = payload.prepare_failure_counts && typeof payload.prepare_failure_counts === 'object'
    ? payload.prepare_failure_counts
    : {}

  let status: DerivedTask['status'] = 'assigned'
  if (payload.system_run_missing || payload.scheduled_zero) {
    status = 'awaiting_owner'
  } else if (completed >= quotaTarget || (payload.prepare_ran && availableSlots.length === 0 && completed > 0)) {
    status = 'done'
  } else if (failures.length > 0) {
    status = 'review'
  } else if (payload.prepare_ran || reserved > 0) {
    status = 'in_progress'
  }

  const description = [
    `Date: ${payload.date || dateKey}`,
    `Prepared: ${payload.prepared || 0}`,
    `Reserved today: ${reserved}`,
    `Available slots: ${formatSlots(availableSlots)}`,
    `Failures: ${failures.length ? failures.join(', ') : 'none'}`,
    `Failure counts: ${JSON.stringify(failureCounts)}`,
  ].join('\n')

  return toDerivedTask({
    id: -1002,
    title: '업무02 Holy Hedgehog 일일 배치',
    description,
    status,
    priority: 'high',
    assignedTo: HH_AGENT,
    createdAt: Math.floor(stat.birthtimeMs / 1000) || Math.floor(stat.mtimeMs / 1000),
    updatedAt: Math.floor(stat.mtimeMs / 1000),
    tags: ['runtime', 'hh', 'publish'],
    metadata: {
      runtimeSource: 'hh_daily_status',
      runtimeSourcePath: filePath,
      prepared: Number(payload.prepared || 0),
      reservedToday: reserved,
      publishedToday: published,
      quotaTarget,
      availableSlots,
      failures,
      failureCounts,
    },
  })
}

function deriveNewsTask(paths: RuntimePaths, now: Date): DerivedTask | null {
  if (!paths.stockNewsRunsPath || !fs.existsSync(paths.stockNewsRunsPath)) return null
  const payload = lastJsonlObject(paths.stockNewsRunsPath) as DailyNewsRun | null
  if (!payload) return null

  const runAt = payload.run_at ? new Date(payload.run_at) : null
  const runDateKey = runAt ? toKstDateKey(runAt) : null
  const todayKey = toKstDateKey(now)
  const scheduledAt = withKstTime(todayKey, 15, 0)

  let status: DerivedTask['status'] = 'assigned'
  if (runDateKey === todayKey && payload.send_success && !payload.dry_run) {
    status = 'done'
  } else if (now >= scheduledAt) {
    status = 'awaiting_owner'
  }

  const description = [
    `Latest run: ${payload.run_at || 'none'}`,
    `Send success: ${payload.send_success ? 'yes' : 'no'}`,
    `Dry run: ${payload.dry_run ? 'yes' : 'no'}`,
    `Articles: ${payload.article_count || 0}`,
    `Chunks: ${payload.chunk_count || 0}`,
    `Error: ${payload.error || 'none'}`,
  ].join('\n')

  const updatedAt = runAt ? Math.floor(runAt.getTime() / 1000) : Math.floor(now.getTime() / 1000)

  return toDerivedTask({
    id: -1001,
    title: '업무01 미국 주식 뉴스 15:00 전송',
    description,
    status,
    priority: 'medium',
    assignedTo: NEWS_AGENT,
    createdAt: updatedAt,
    updatedAt,
    tags: ['runtime', 'news', 'telegram'],
    metadata: {
      runtimeSource: 'daily_us_stock_news',
      runtimeSourcePath: paths.stockNewsRunsPath,
      scheduledTime: scheduledAt.toISOString(),
      latestRunAt: payload.run_at || null,
      sendSuccess: Boolean(payload.send_success),
      dryRun: Boolean(payload.dry_run),
      articleCount: Number(payload.article_count || 0),
      chunkCount: Number(payload.chunk_count || 0),
      error: payload.error || null,
    },
  })
}

function deriveGrowthTask(paths: RuntimePaths): DerivedTask | null {
  const uploadsDir = paths.holyhedgehogRoot ? path.join(paths.holyhedgehogRoot, 'content', 'growth', 'uploads') : ''
  if (!uploadsDir || !fs.existsSync(uploadsDir)) return null

  const youtube = latestGrowthResult(uploadsDir, 'youtube')
  const x = latestGrowthResult(uploadsDir, 'x')
  const youtubeUpload = latestGrowthUploadPackage(uploadsDir, 'youtube')
  const xUpload = latestGrowthUploadPackage(uploadsDir, 'x')
  if (!youtube && !x && !youtubeUpload && !xUpload) return null

  const statuses = [youtube?.status, x?.status].filter(Boolean).map((value) => String(value))
  let status: DerivedTask['status'] = 'assigned'
  if (statuses.includes('failed')) {
    status = 'review'
  } else if (statuses.length > 0 && statuses.every((value) => value === 'completed')) {
    status = 'done'
  } else if (statuses.length > 0) {
    status = 'in_progress'
  }

  const updatedAtCandidates = [youtube?.generated_at, x?.generated_at, youtubeUpload?.generated_at, xUpload?.generated_at]
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => Number.isFinite(value))
  const updatedAt = updatedAtCandidates.length > 0 ? Math.floor(Math.max(...updatedAtCandidates) / 1000) : Math.floor(Date.now() / 1000)

  const description = [
    `YouTube: ${youtube?.status || 'missing'}${(youtube?.source_slug || youtubeUpload?.source_slug) ? ` (${youtube?.source_slug || youtubeUpload?.source_slug})` : ''}`,
    `X: ${x?.status || 'missing'}${(x?.source_slug || xUpload?.source_slug) ? ` (${x?.source_slug || xUpload?.source_slug})` : ''}`,
    youtubeUpload?.transport ? `YouTube transport: ${String(youtubeUpload.transport)}` : '',
    xUpload?.transport ? `X transport: ${String(xUpload.transport)}` : '',
    youtube?.result_text ? `YouTube note: ${String(youtube.result_text)}` : '',
    x?.result_text ? `X note: ${String(x.result_text)}` : '',
  ].filter(Boolean).join('\n')

  return toDerivedTask({
    id: -1003,
    title: '업무03 growth-ops 업로더 상태',
    description,
    status,
    priority: 'medium',
    assignedTo: GROWTH_AGENT,
    createdAt: updatedAt,
    updatedAt,
    tags: ['runtime', 'growth', 'youtube', 'x'],
    metadata: {
      runtimeSource: 'growth_uploads',
      runtimeSourcePath: uploadsDir,
      youtubeStatus: youtube?.status || null,
      youtubeSlug: youtube?.source_slug || youtubeUpload?.source_slug || null,
      youtubeNote: youtube?.result_text || null,
      youtubeTransport: youtubeUpload?.transport || null,
      youtubeApprovalStatus: youtubeUpload?.approval_status || null,
      youtubePackageStatus: youtubeUpload?.package_status || null,
      xStatus: x?.status || null,
      xSlug: x?.source_slug || xUpload?.source_slug || null,
      xNote: x?.result_text || null,
      xTransport: xUpload?.transport || null,
      xApprovalStatus: xUpload?.approval_status || null,
      xPackageStatus: xUpload?.package_status || null,
      ctaUrl: youtubeUpload?.cta_url || xUpload?.cta_url || null,
    },
  })
}

function deriveBizTask(paths: RuntimePaths): DerivedTask | null {
  if (!paths.bizReportsDir || !fs.existsSync(paths.bizReportsDir)) return null
  const latest = latestFile(paths.bizReportsDir, /\.json$/)
  if (!latest) return null
  const payload = readJsonFile(latest)
  if (!payload) return null
  const stat = fs.statSync(latest)

  let status: DerivedTask['status'] = 'assigned'
  if (Number(payload.human_review_queue || 0) > 0) {
    status = 'review'
  } else if (Number(payload.proposal_count || 0) > 0 || Number(payload.build_plan_count || 0) > 0) {
    status = 'in_progress'
  } else if (Number(payload.brief_count || 0) === 0 && Number(payload.total_collected || 0) > 0) {
    status = 'awaiting_owner'
  }

  const description = [
    `Report date: ${payload.date || 'unknown'}`,
    `Collected: ${payload.total_collected || 0}`,
    `Normalized: ${payload.normalized_count || 0}`,
    `Human review queue: ${payload.human_review_queue || 0}`,
    `Briefs: ${payload.brief_count || 0}`,
    `Proposals: ${payload.proposal_count || 0}`,
    `Build plans: ${payload.build_plan_count || 0}`,
  ].join('\n')

  return toDerivedTask({
    id: -1004,
    title: '업무04 biz-ops 파이프라인 상태',
    description,
    status,
    priority: 'medium',
    assignedTo: BIZ_AGENT,
    createdAt: Math.floor(stat.birthtimeMs / 1000) || Math.floor(stat.mtimeMs / 1000),
    updatedAt: Math.floor(stat.mtimeMs / 1000),
    tags: ['runtime', 'biz', 'proposal'],
    metadata: {
      runtimeSource: 'biz_report',
      runtimeSourcePath: latest,
      reportDate: payload.date || null,
      totalCollected: Number(payload.total_collected || 0),
      normalizedCount: Number(payload.normalized_count || 0),
      humanReviewQueue: Number(payload.human_review_queue || 0),
      briefCount: Number(payload.brief_count || 0),
      proposalCount: Number(payload.proposal_count || 0),
      buildPlanCount: Number(payload.build_plan_count || 0),
    },
  })
}

export function getRuntimeDerivedTasks(options: RuntimeTaskOptions = {}): DerivedTask[] {
  const now = options.now || new Date()
  const paths = runtimePaths(options)
  return [
    deriveNewsTask(paths, now),
    deriveHhTask(paths, now),
    deriveGrowthTask(paths),
    deriveBizTask(paths),
  ].filter((task): task is DerivedTask => Boolean(task))
}

export function isRuntimeDerivedTask(task: { metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return Boolean(task?.metadata?.runtimeDerived)
}
