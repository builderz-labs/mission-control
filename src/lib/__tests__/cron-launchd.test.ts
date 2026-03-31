import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getLaunchdManagedCronJobs, getLegacyShadowNames } from '@/lib/cron-launchd'

const tempRoots: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cron-launchd-'))
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

describe('cron-launchd', () => {
  it('projects launchd-managed HH/news jobs and adds missing follow-up slots', () => {
    const root = makeTempDir()
    const homeDir = path.join(root, 'home')
    const hhRoot = path.join(root, 'hh')
    const launchAgentsDir = path.join(homeDir, 'Library', 'LaunchAgents')
    fs.mkdirSync(launchAgentsDir, { recursive: true })
    for (const plist of [
      'ai.openclaw.hh-prepare-daily.plist',
      'ai.openclaw.hh-autoresearch.plist',
      'ai.openclaw.hh-publish-followups.plist',
      'ai.openclaw.daily-us-stock-news.plist',
    ]) {
      fs.writeFileSync(path.join(launchAgentsDir, plist), '<plist />')
    }

    writeJson(path.join(hhRoot, 'content', 'plans', 'hh-daily-status-2026-03-30.json'), {
      date: '2026-03-30',
      prepared: 2,
      published: 1,
      future_reserved_today: 2,
      prepare_ran: true,
      prepare_failures: ['selector_failure'],
    })
    fs.mkdirSync(path.join(hhRoot, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(hhRoot, 'logs', 'hh-autoresearch.log'), 'status: ok\n')
    fs.writeFileSync(path.join(hhRoot, 'logs', 'cron-followups.log'), 'follow-up ok\n')
    fs.writeFileSync(path.join(hhRoot, 'logs', 'cron-2pm.log'), 'follow-up ok\n')
    fs.writeFileSync(path.join(hhRoot, 'logs', 'cron-5pm.log'), 'follow-up ok\n')
    fs.writeFileSync(path.join(hhRoot, 'logs', 'cron-8pm.log'), 'follow-up ok\n')
    const newsRunsPath = path.join(root, 'logs', 'daily_us_stock_news_runs.jsonl')
    fs.mkdirSync(path.dirname(newsRunsPath), { recursive: true })
    fs.writeFileSync(newsRunsPath, JSON.stringify({
      run_at: '2026-03-30T15:00:05+09:00',
      send_success: true,
      dry_run: false,
      article_count: 14,
    }) + '\n')

    const jobs = getLaunchdManagedCronJobs({
      homeDir,
      holyhedgehogRoot: hhRoot,
      stockNewsRunsPath: newsRunsPath,
      now: new Date('2026-03-30T20:30:00+09:00'),
    })

    expect(jobs.map((job) => job.name)).toEqual(expect.arrayContaining([
      'Holy Hedgehog - Daily Prepare',
      'Holy Hedgehog - Autoresearch 5AM',
      'Holy Hedgehog - Follow-up 9:30AM',
      'Holy Hedgehog - Follow-up 12:30PM',
      'Holy Hedgehog - Follow-up 2PM',
      'Holy Hedgehog - Follow-up 5PM',
      'Holy Hedgehog - Follow-up 8PM',
      'Daily US Stock News',
    ]))

    const prepare = jobs.find((job) => job.name === 'Holy Hedgehog - Daily Prepare')
    const news = jobs.find((job) => job.name === 'Daily US Stock News')
    expect(prepare?.enabled).toBe(true)
    expect(prepare?.lastStatus).toBe('error')
    expect(news?.lastStatus).toBe('success')
  })

  it('returns the legacy names that should be shadowed from cron placeholders', () => {
    expect(getLegacyShadowNames()).toEqual(expect.arrayContaining([
      'Daily US Stock News',
      'Holy Hedgehog - Daily Prepare',
      'Holy Hedgehog - Autoresearch 5AM',
      'Holy Hedgehog - Follow-up 2PM',
      'Holy Hedgehog - Follow-up 5PM',
      'Holy Hedgehog - Follow-up 8PM',
    ]))
  })
})
