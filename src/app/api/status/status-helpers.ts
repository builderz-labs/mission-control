import os from 'node:os'
import { statSync } from 'node:fs'
import { runCommand } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions, getAgentLiveStatuses } from '@/lib/sessions'
import { logger } from '@/lib/logger'

export interface SystemStatus {
  timestamp: number
  uptime: number
  memory: { total: number; used: number; available: number }
  disk: { total: string | number; used: string | number; available: string | number; usage?: string }
  sessions: { total: number; active: number }
  processes: Array<{ pid: string; command: string }>
}

export interface MemorySnapshot {
  totalBytes: number
  availableBytes: number
  usedBytes: number
  usagePercent: number
}

export async function getMemorySnapshot(): Promise<MemorySnapshot> {
  const totalBytes = os.totalmem()
  let availableBytes = os.freemem()

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('vm_stat', [], { timeoutMs: 3000 })
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/i)
      const pageSize = parseInt(pageSizeMatch?.[1] || '4096', 10)
      const pageLabels = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable']

      const availablePages = pageLabels.reduce((sum, label) => {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const match = stdout.match(new RegExp(`${escapedLabel}:\\s+([\\d.]+)`, 'i'))
        const pages = parseInt((match?.[1] || '0').replace(/\./g, ''), 10)
        return sum + (Number.isFinite(pages) ? pages : 0)
      }, 0)

      const vmAvailableBytes = availablePages * pageSize
      if (vmAvailableBytes > 0) {
        availableBytes = Math.min(vmAvailableBytes, totalBytes)
      }
    } catch {
      // Fall back to os.freemem()
    }
  } else {
    try {
      const { stdout } = await runCommand('free', ['-b'], { timeoutMs: 3000 })
      const memLine = stdout.split('\n').find((line) => line.startsWith('Mem:'))
      if (memLine) {
        const parts = memLine.trim().split(/\s+/)
        const available = parseInt(parts[6] || parts[3] || '0', 10)
        if (Number.isFinite(available) && available > 0) {
          availableBytes = Math.min(available, totalBytes)
        }
      }
    } catch {
      // Fall back to os.freemem()
    }
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes)
  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0

  return { totalBytes, availableBytes, usedBytes, usagePercent }
}

export function getDbStats(workspaceId: number) {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const day = now - 86400
    const week = now - 7 * 86400

    const taskStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>
    const tasksByStatus: Record<string, number> = {}
    let totalTasks = 0
    for (const row of taskStats) {
      tasksByStatus[row.status] = row.count
      totalTasks += row.count
    }

    const agentStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM agents WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>
    const agentsByStatus: Record<string, number> = {}
    let totalAgents = 0
    for (const row of agentStats) {
      agentsByStatus[row.status] = row.count
      totalAgents += row.count
    }

    const auditDay = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(day) as { c: number }).c
    const auditWeek = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(week) as { c: number }).c
    const loginFailures = (db.prepare(
      "SELECT COUNT(*) as c FROM audit_log WHERE action = 'login_failed' AND created_at > ?"
    ).get(day) as { c: number }).c

    const activityDay = (
      db.prepare('SELECT COUNT(*) as c FROM activities WHERE created_at > ? AND workspace_id = ?').get(day, workspaceId) as { c: number }
    ).c

    const unreadNotifs = (
      db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL AND workspace_id = ?').get(workspaceId) as { c: number }
    ).c

    let pipelineActive = 0
    let pipelineRecent = 0
    try {
      pipelineActive = (db.prepare("SELECT COUNT(*) as c FROM pipeline_runs WHERE status = 'running'").get() as { c: number }).c
      pipelineRecent = (db.prepare('SELECT COUNT(*) as c FROM pipeline_runs WHERE created_at > ?').get(day) as { c: number }).c
    } catch {
      // Pipeline tables may not exist yet
    }

    let latestBackup: { name: string; size: number; age_hours: number } | null = null
    try {
      const { readdirSync } = require('fs')
      const { join, dirname } = require('path')
      const backupDir = join(dirname(config.dbPath), 'backups')
      const files = readdirSync(backupDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => {
          const stat = statSync(join(backupDir, f))
          return { name: f, size: stat.size, mtime: stat.mtimeMs }
        })
        .sort((a: { name: string; size: number; mtime: number }, b: { name: string; size: number; mtime: number }) => b.mtime - a.mtime)
      if (files.length > 0) {
        latestBackup = {
          name: files[0].name,
          size: files[0].size,
          age_hours: Math.round((Date.now() - files[0].mtime) / 3600000),
        }
      }
    } catch {
      // No backups dir
    }

    let dbSizeBytes = 0
    try {
      dbSizeBytes = statSync(config.dbPath).size
    } catch {
      // ignore
    }

    let webhookCount = 0
    try {
      webhookCount = (db.prepare('SELECT COUNT(*) as c FROM webhooks').get() as { c: number }).c
    } catch {
      // table may not exist
    }

    return {
      tasks: { total: totalTasks, byStatus: tasksByStatus },
      agents: { total: totalAgents, byStatus: agentsByStatus },
      audit: { day: auditDay, week: auditWeek, loginFailures },
      activities: { day: activityDay },
      notifications: { unread: unreadNotifs },
      pipelines: { active: pipelineActive, recentDay: pipelineRecent },
      backup: latestBackup,
      dbSizeBytes,
      webhookCount,
    }
  } catch (err) {
    logger.error({ err }, 'getDbStats error')
    return null
  }
}

export async function getDashboardData(workspaceId: number) {
  const [system, dbStats] = await Promise.all([
    getSystemStatus(workspaceId),
    getDbStats(workspaceId),
  ])

  return { ...system, db: dbStats }
}

export async function getSystemStatus(workspaceId: number): Promise<SystemStatus> {
  const status: SystemStatus = {
    timestamp: Date.now(),
    uptime: 0,
    memory: { total: 0, used: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0 },
    sessions: { total: 0, active: 0 },
    processes: []
  }

  try {
    // System uptime (cross-platform)
    if (process.platform === 'darwin') {
      const { stdout } = await runCommand('sysctl', ['-n', 'kern.boottime'], { timeoutMs: 3000 })
      const match = stdout.match(/sec\s*=\s*(\d+)/)
      if (match) {
        status.uptime = Date.now() - parseInt(match[1]) * 1000
      }
    } else {
      const { stdout } = await runCommand('uptime', ['-s'], { timeoutMs: 3000 })
      const bootTime = new Date(stdout.trim())
      status.uptime = Date.now() - bootTime.getTime()
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting uptime')
  }

  try {
    const snapshot = await getMemorySnapshot()
    status.memory = {
      total: Math.round(snapshot.totalBytes / (1024 * 1024)),
      used: Math.round(snapshot.usedBytes / (1024 * 1024)),
      available: Math.round(snapshot.availableBytes / (1024 * 1024)),
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting memory info')
  }

  try {
    const { stdout: diskOutput } = await runCommand('df', ['-h', '/'], { timeoutMs: 3000 })
    const lastLine = diskOutput.trim().split('\n').pop() || ''
    const diskParts = lastLine.split(/\s+/)
    if (diskParts.length >= 4) {
      status.disk = {
        total: diskParts[1],
        used: diskParts[2],
        available: diskParts[3],
        usage: diskParts[4]
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting disk info')
  }

  try {
    const { stdout: processOutput } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 })
    const processes = processOutput.split('\n')
      .filter(line => line.trim())
      .filter(line => !line.trim().toLowerCase().startsWith('pid '))
      .map(line => {
        const parts = line.trim().split(/\s+/)
        return { pid: parts[0], command: parts.slice(2).join(' ') }
      })
      .filter((proc) => /clawdbot|openclaw/i.test(proc.command))
    status.processes = processes
  } catch (error) {
    logger.error({ err: error }, 'Error getting process info')
  }

  try {
    const gatewaySessions = getAllGatewaySessions()
    status.sessions = {
      total: gatewaySessions.length,
      active: gatewaySessions.filter((s) => s.active).length,
    }

    // Sync agent statuses in DB from live session data
    try {
      const db = getDatabase()
      const liveStatuses = getAgentLiveStatuses()
      const now = Math.floor(Date.now() / 1000)
      const updateStmt = db.prepare(
        `UPDATE agents SET status = ?, last_seen = ?, updated_at = ?
         WHERE workspace_id = ?
           AND (LOWER(name) = LOWER(?)
           OR LOWER(REPLACE(name, ' ', '-')) = LOWER(?))`
      )
      for (const [agentName, info] of liveStatuses) {
        updateStmt.run(info.status, Math.floor(info.lastActivity / 1000), now, workspaceId, agentName, agentName)
      }
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Error syncing agent statuses')
    }
  } catch (error) {
    logger.error({ err: error }, 'Error reading session stores')
  }

  return status
}
