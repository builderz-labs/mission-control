/**
 * Cleanup script: deduplicate jobs.json
 * Backs up original → deduplicates by name (keeps latest) → writes clean file
 *
 * Usage: bun run scripts/cleanup-cron-jobs.ts
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw')
const CRON_FILE = join(OPENCLAW_HOME, 'cron', 'jobs.json')

interface CronJob {
    id: string
    name: string
    createdAtMs?: number
    [key: string]: any
}

interface CronFile {
    version: number
    jobs: CronJob[]
}

try {
    const raw = readFileSync(CRON_FILE, 'utf-8')
    const data: CronFile = JSON.parse(raw)

    const before = data.jobs.length
    console.log(`📂 File: ${CRON_FILE}`)
    console.log(`📊 Before: ${before} jobs`)

    // Backup
    const backupPath = CRON_FILE + '.bak'
    copyFileSync(CRON_FILE, backupPath)
    console.log(`💾 Backup: ${backupPath}`)

    // Dedup: keep latest per name
    const latest = new Map<string, CronJob>()
    for (const job of data.jobs) {
        const existing = latest.get(job.name)
        if (!existing || (job.createdAtMs || 0) > (existing.createdAtMs || 0)) {
            latest.set(job.name, job)
        }
    }

    data.jobs = [...latest.values()]
    const after = data.jobs.length

    writeFileSync(CRON_FILE, JSON.stringify(data, null, 2))

    console.log(`✅ After: ${after} jobs`)
    console.log(`🗑️  Removed: ${before - after} duplicates`)
    console.log('')
    console.log('Remaining jobs:')
    for (const job of data.jobs) {
        console.log(`  - ${job.name} (id: ${job.id}, agent: ${job.agentId})`)
    }
} catch (err) {
    console.error('❌ Error:', err)
    process.exit(1)
}
