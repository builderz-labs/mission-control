import { NextRequest, NextResponse } from 'next/server'
import { runCommand } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export interface ActiveRun {
  id: string
  name: string
  type: 'tmux' | 'systemd' | 'cron' | 'process'
  owner: string
  status: 'running' | 'stopped' | 'failed' | 'stale'
  pid?: string
  startedAt?: string
  lastProgress?: string
  outputSnippet?: string
  unit?: string
  logPath?: string
}

const STALE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [tmux, systemd, cron, processes] = await Promise.allSettled([
      scanTmuxSessions(),
      scanSystemdUnits(),
      scanCronJobs(),
      scanKnownProcesses(),
    ])

    const runs: ActiveRun[] = [
      ...(tmux.status === 'fulfilled' ? tmux.value : []),
      ...(systemd.status === 'fulfilled' ? systemd.value : []),
      ...(cron.status === 'fulfilled' ? cron.value : []),
      ...(processes.status === 'fulfilled' ? processes.value : []),
    ]

    const activeCount = runs.filter(r => r.status === 'running').length
    const staleCount = runs.filter(r => r.status === 'stale').length
    const stoppedCount = runs.filter(r => r.status === 'stopped' || r.status === 'failed').length

    return NextResponse.json({
      runs,
      summary: { total: runs.length, active: activeCount, stale: staleCount, stopped: stoppedCount },
      scannedAt: new Date().toISOString(),
    })
  } catch (error) {
    logger.error({ err: error }, 'Active runs scan error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function scanTmuxSessions(): Promise<ActiveRun[]> {
  const runs: ActiveRun[] = []

  // Try custom socket first (OpenClaw convention), then default
  const sockets = ['~/.tmux/sock', '']
  for (const sock of sockets) {
    try {
      const args = sock
        ? ['-S', sock.replace('~', process.env.HOME || ''), 'list-sessions', '-F', '#{session_name}|#{session_created}|#{session_activity}|#{session_windows}']
        : ['list-sessions', '-F', '#{session_name}|#{session_created}|#{session_activity}|#{session_windows}']

      const { stdout, code } = await runCommand('tmux', args, { timeoutMs: 5000 })
      if (code !== 0 || !stdout.trim()) continue

      for (const line of stdout.trim().split('\n')) {
        const [name, created, activity, windows] = line.split('|')
        if (!name) continue

        const createdMs = parseInt(created) * 1000
        const activityMs = parseInt(activity) * 1000
        const isStale = Date.now() - activityMs > STALE_THRESHOLD_MS

        // Grab last few lines from the active pane
        let snippet = ''
        try {
          const captureArgs = sock
            ? ['-S', sock.replace('~', process.env.HOME || ''), 'capture-pane', '-t', name, '-p']
            : ['capture-pane', '-t', name, '-p']
          const { stdout: paneOutput } = await runCommand('tmux', captureArgs, { timeoutMs: 3000 })
          const lines = paneOutput.trim().split('\n').filter(l => l.trim())
          snippet = lines.slice(-5).join('\n')
        } catch { /* ignore */ }

        runs.push({
          id: `tmux-${name}`,
          name,
          type: 'tmux',
          owner: inferOwner(name),
          status: isStale ? 'stale' : 'running',
          startedAt: new Date(createdMs).toISOString(),
          lastProgress: new Date(activityMs).toISOString(),
          outputSnippet: snippet || undefined,
        })
      }
    } catch {
      // tmux not running or socket unavailable
    }
  }

  // Deduplicate by name (custom socket sessions may overlap with default)
  const seen = new Set<string>()
  return runs.filter(r => {
    if (seen.has(r.name)) return false
    seen.add(r.name)
    return true
  })
}

async function scanSystemdUnits(): Promise<ActiveRun[]> {
  const runs: ActiveRun[] = []

  try {
    // List user units matching known patterns
    const { stdout, code } = await runCommand('systemctl', [
      '--user', 'list-units', '--type=service', '--all', '--no-pager', '--plain',
      '--no-legend',
    ], { timeoutMs: 5000 })

    if (code !== 0) return runs

    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue
      const parts = line.trim().split(/\s+/)
      const unit = parts[0] || ''
      const load = parts[1] || ''
      const active = parts[2] || ''
      const sub = parts[3] || ''

      // Only show relevant units (btc5m, openclaw, collector, etc.)
      if (!isRelevantUnit(unit)) continue

      let status: ActiveRun['status'] = 'stopped'
      if (active === 'active' && sub === 'running') status = 'running'
      else if (active === 'failed') status = 'failed'

      // Get unit details
      let startedAt: string | undefined
      let snippet: string | undefined
      try {
        const { stdout: showOut } = await runCommand('systemctl', [
          '--user', 'show', unit,
          '--property=ActiveEnterTimestamp,MainPID',
        ], { timeoutMs: 3000 })

        const tsMatch = showOut.match(/ActiveEnterTimestamp=(.+)/)
        if (tsMatch?.[1] && tsMatch[1] !== 'n/a') {
          startedAt = new Date(tsMatch[1]).toISOString()
        }
      } catch { /* ignore */ }

      // Get recent journal output
      try {
        const { stdout: journalOut } = await runCommand('journalctl', [
          '--user', '-u', unit, '--no-pager', '-n', '5', '--output=short',
        ], { timeoutMs: 3000 })
        const lines = journalOut.trim().split('\n').filter(l => l.trim())
        snippet = lines.slice(-5).join('\n')
      } catch { /* ignore */ }

      runs.push({
        id: `systemd-${unit}`,
        name: unit.replace('.service', ''),
        type: 'systemd',
        owner: inferOwner(unit),
        status,
        unit,
        startedAt,
        outputSnippet: snippet || undefined,
      })
    }
  } catch {
    // systemd --user not available
  }

  return runs
}

async function scanCronJobs(): Promise<ActiveRun[]> {
  const runs: ActiveRun[] = []

  try {
    const { stdout, code } = await runCommand('crontab', ['-l'], { timeoutMs: 5000 })
    if (code !== 0) return runs

    let idx = 0
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue

      // Parse cron line: schedule + command
      const match = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
      if (!match) continue

      const schedule = match[1]
      const command = match[2]
      idx++

      // Extract a readable name from the command
      const name = extractCronName(command)

      runs.push({
        id: `cron-${idx}`,
        name,
        type: 'cron',
        owner: inferOwner(command),
        status: 'running', // cron jobs are always "scheduled"
        outputSnippet: `Schedule: ${schedule}\nCommand: ${command.substring(0, 200)}`,
      })
    }
  } catch {
    // crontab not available
  }

  return runs
}

async function scanKnownProcesses(): Promise<ActiveRun[]> {
  const runs: ActiveRun[] = []

  try {
    const { stdout } = await runCommand('ps', [
      '-eo', 'pid,etimes,args', '--no-headers',
    ], { timeoutMs: 5000 })

    const patterns = [
      { pattern: /btc_5m_latency/, owner: 'ralph', label: 'btc-5m-latency collector' },
      { pattern: /scanner_cron|profit_exit/, owner: 'ralph', label: 'polymarket scanner' },
      { pattern: /collect\.py.*dashboard/, owner: 'obsidian', label: 'dashboard collector' },
      { pattern: /xpost|xqueue/, owner: 'ralph', label: 'X post queue' },
      { pattern: /mc-report/, owner: 'system', label: 'MC reporter' },
    ]

    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (!match) continue

      const [, pid, etimeStr, command] = match
      const elapsed = parseInt(etimeStr) * 1000

      for (const p of patterns) {
        if (p.pattern.test(command)) {
          const startedAt = new Date(Date.now() - elapsed).toISOString()
          const isStale = elapsed > STALE_THRESHOLD_MS && !p.pattern.test('cron')

          runs.push({
            id: `proc-${pid}`,
            name: p.label,
            type: 'process',
            owner: p.owner,
            status: isStale ? 'stale' : 'running',
            pid,
            startedAt,
            lastProgress: startedAt,
            outputSnippet: command.substring(0, 300),
          })
          break
        }
      }
    }
  } catch {
    // ps not available
  }

  return runs
}

function inferOwner(name: string): string {
  const lower = name.toLowerCase()
  if (/ralph|btc|paper|trade|scanner|xpost|xmeme|meme/.test(lower)) return 'ralph'
  if (/obsidian|collect|dashboard|mc-/.test(lower)) return 'obsidian'
  if (/sentinel|metar|weather|monitor/.test(lower)) return 'sentinel'
  return 'system'
}

function isRelevantUnit(unit: string): boolean {
  const lower = unit.toLowerCase()
  return /btc5m|openclaw|collector|paper|scanner|sentinel|obsidian|ralph|metar|xpost/.test(lower)
}

function extractCronName(command: string): string {
  // Try to get a meaningful name from the command
  const scriptMatch = command.match(/([\/\w-]+\.(sh|py|js))\b/)
  if (scriptMatch) {
    const parts = scriptMatch[1].split('/')
    return parts[parts.length - 1]
  }
  // Fallback: first 40 chars
  return command.substring(0, 40).trim()
}
