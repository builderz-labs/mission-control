import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getRuntimeDerivedTasks } from '@/lib/runtime-derived-tasks'

const tempRoots: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runtime-tasks-'))
  tempRoots.push(dir)
  return dir
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
}

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

describe('getRuntimeDerivedTasks', () => {
  it('projects hh/news/growth/biz runtime state into read-only tasks', () => {
    const root = makeTempDir()
    const hhRoot = path.join(root, 'hh')
    const bizDir = path.join(root, 'biz-reports')
    const newsRuns = path.join(root, 'logs', 'daily_us_stock_news_runs.jsonl')

    writeJson(path.join(hhRoot, 'content', 'plans', 'hh-daily-status-2026-03-29.json'), {
      date: '2026-03-29',
      prepared: 1,
      future_reserved_today: 1,
      prepare_ran: true,
      prepare_failures: ['affiliate_fail'],
      prepare_failure_counts: { affiliate_fail: 1 },
      available_slots: ['2026-03-29T17:00:00+09:00'],
      scheduled_zero: false,
      system_run_missing: false,
    })
    fs.mkdirSync(path.dirname(newsRuns), { recursive: true })
    fs.writeFileSync(newsRuns, JSON.stringify({
      run_at: '2026-03-29T15:00:05+09:00',
      send_success: true,
      dry_run: false,
      article_count: 12,
      chunk_count: 1,
    }) + '\n')
    writeJson(path.join(hhRoot, 'content', 'growth', 'uploads', 'sample-youtube-page-agent-result.json'), {
      source_slug: 'sample',
      status: 'completed',
      generated_at: '2026-03-29T10:10:00+09:00',
      result_text: 'draft saved',
    })
    writeJson(path.join(hhRoot, 'content', 'growth', 'uploads', 'sample-youtube-upload.json'), {
      source_slug: 'sample',
      transport: 'manual_pending',
      approval_status: 'approval_required',
      package_status: 'approval_required',
      cta_url: 'https://link.coupang.com/a/sample',
      generated_at: '2026-03-29T10:08:00+09:00',
    })
    writeJson(path.join(hhRoot, 'content', 'growth', 'uploads', 'sample-x-page-agent-result.json'), {
      source_slug: 'sample',
      status: 'failed',
      generated_at: '2026-03-29T10:12:00+09:00',
      result_text: 'compose failed',
    })
    writeJson(path.join(hhRoot, 'content', 'growth', 'uploads', 'sample-x-upload.json'), {
      source_slug: 'sample',
      transport: 'manual_pending',
      approval_status: 'approval_required',
      package_status: 'approval_required',
      cta_url: 'https://link.coupang.com/a/sample',
      generated_at: '2026-03-29T10:11:00+09:00',
    })
    writeJson(path.join(bizDir, '2026-03-29-biz-report.json'), {
      date: '2026-03-29',
      total_collected: 2,
      human_review_queue: 1,
      brief_count: 1,
      proposal_count: 0,
      build_plan_count: 0,
    })

    const tasks = getRuntimeDerivedTasks({
      now: new Date('2026-03-29T16:00:00+09:00'),
      holyhedgehogRoot: hhRoot,
      bizReportsDir: bizDir,
      stockNewsRunsPath: newsRuns,
    })

    expect(tasks).toHaveLength(4)
    expect(tasks.every((task) => task.metadata.runtimeDerived === true)).toBe(true)
    const newsTask = tasks.find((task) => task.title.includes('업무01'))
    const hhTask = tasks.find((task) => task.title.includes('업무02'))
    const growthTask = tasks.find((task) => task.title.includes('업무03'))
    const bizTask = tasks.find((task) => task.title.includes('업무04'))

    expect(newsTask?.status).toBe('done')
    expect(newsTask?.metadata.latestRunAt).toBe('2026-03-29T15:00:05+09:00')
    expect(newsTask?.metadata.sendSuccess).toBe(true)

    expect(hhTask?.status).toBe('review')
    expect(hhTask?.metadata.reservedToday).toBe(1)
    expect(hhTask?.metadata.prepared).toBe(1)
    expect(hhTask?.metadata.failureCounts).toEqual({ affiliate_fail: 1 })

    expect(growthTask?.status).toBe('review')
    expect(growthTask?.metadata.youtubeStatus).toBe('completed')
    expect(growthTask?.metadata.xStatus).toBe('failed')
    expect(growthTask?.metadata.youtubeNote).toBe('draft saved')
    expect(growthTask?.metadata.xNote).toBe('compose failed')
    expect(growthTask?.metadata.youtubeTransport).toBe('manual_pending')
    expect(growthTask?.metadata.xTransport).toBe('manual_pending')
    expect(growthTask?.metadata.youtubeApprovalStatus).toBe('approval_required')
    expect(growthTask?.metadata.xApprovalStatus).toBe('approval_required')
    expect(growthTask?.metadata.ctaUrl).toBe('https://link.coupang.com/a/sample')

    expect(bizTask?.status).toBe('review')
    expect(bizTask?.metadata.humanReviewQueue).toBe(1)
    expect(bizTask?.metadata.briefCount).toBe(1)
  })

  it('keeps news task pending before 15:00 when today has not run yet', () => {
    const root = makeTempDir()
    const newsRuns = path.join(root, 'logs', 'daily_us_stock_news_runs.jsonl')
    fs.mkdirSync(path.dirname(newsRuns), { recursive: true })
    fs.writeFileSync(newsRuns, JSON.stringify({
      run_at: '2026-03-28T15:00:05+09:00',
      send_success: true,
      dry_run: false,
    }) + '\n')

    const tasks = getRuntimeDerivedTasks({
      now: new Date('2026-03-29T10:00:00+09:00'),
      holyhedgehogRoot: '',
      bizReportsDir: '',
      stockNewsRunsPath: newsRuns,
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe('assigned')
  })
})
