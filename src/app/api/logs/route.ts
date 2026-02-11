import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'

const LOGS_PATH = config.logsDir

interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: any
}

/**
 * Parse a log line from various OpenClaw log formats:
 * - Pipe-delimited: "2026-02-09T17:00:01+01:00|MONITOR|Consistency check completed"
 * - Simple text: "done report=/home/openclaw/.openclaw/workspace-jarv/reports/..."
 * - JSON structured: { timestamp, level, message, ... }
 * - Gateway journal: "2026-02-09T18:05:49+01:00 hetzner-jarv openclaw[1737454]: ..."
 */
function parseLogLine(line: string, source: string): LogEntry | null {
  if (!line.trim()) return null

  try {
    // Try JSON first
    if (line.startsWith('{')) {
      const parsed = JSON.parse(line)
      return {
        id: `${source}-${parsed.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: parsed.timestamp || Date.now(),
        level: parsed.level || 'info',
        source: parsed.source || source,
        session: parsed.session,
        message: parsed.message || line,
        data: parsed.data,
      }
    }

    // Pipe-delimited format: "TIMESTAMP|LEVEL|MESSAGE"
    const pipeMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+[^\|]*)\|([^\|]+)\|(.+)$/)
    if (pipeMatch) {
      const ts = new Date(pipeMatch[1]).getTime()
      const levelRaw = pipeMatch[2].trim().toLowerCase()
      let level: LogEntry['level'] = 'info'
      if (levelRaw === 'error' || levelRaw === 'err') level = 'error'
      else if (levelRaw === 'warn' || levelRaw === 'warning') level = 'warn'
      else if (levelRaw === 'debug') level = 'debug'
      else if (levelRaw === 'ok' || levelRaw === 'monitor' || levelRaw === 'info') level = 'info'

      return {
        id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: isNaN(ts) ? Date.now() : ts,
        level,
        source,
        message: pipeMatch[3].trim(),
      }
    }

    // Gateway journal format: "TIMESTAMP HOSTNAME openclaw[PID]: MESSAGE"
    const journalMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+[^\s]*)\s+\S+\s+\S+:\s+(.+)$/)
    if (journalMatch) {
      const ts = new Date(journalMatch[1]).getTime()
      const msg = journalMatch[2]
      let level: LogEntry['level'] = 'info'
      if (msg.includes('error') || msg.includes('Error') || msg.includes('ERR')) level = 'error'
      else if (msg.includes('warn') || msg.includes('WARN')) level = 'warn'
      else if (msg.includes('debug') || msg.includes('DEBUG')) level = 'debug'

      return {
        id: `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: isNaN(ts) ? Date.now() : ts,
        level,
        source,
        message: msg,
      }
    }

    // ISO timestamp prefix: "2026-02-09T... [LEVEL] message"
    const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)/)
    const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG)\]/i) || line.match(/(ERROR|WARN|INFO|DEBUG):/i)

    let timestamp = Date.now()
    if (isoMatch) {
      const t = new Date(isoMatch[1]).getTime()
      if (!isNaN(t)) timestamp = t
    }

    let level: LogEntry['level'] = 'info'
    if (levelMatch) {
      level = levelMatch[1].toLowerCase() as LogEntry['level']
    } else if (line.toLowerCase().includes('error')) {
      level = 'error'
    } else if (line.toLowerCase().includes('warn')) {
      level = 'warn'
    }

    return {
      id: `${source}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      level,
      source,
      message: line.trim(),
    }
  } catch {
    return {
      id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      level: 'info',
      source,
      message: line.trim(),
    }
  }
}

/**
 * Discover all log files in the OpenClaw logs directory.
 * Scans both top-level and automation/ subdirectory.
 */
async function discoverLogFiles(): Promise<Array<{ path: string; source: string }>> {
  const files: Array<{ path: string; source: string }> = []
  if (!LOGS_PATH) return files

  try {
    const entries = await readdir(LOGS_PATH, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.log')) {
        files.push({
          path: join(LOGS_PATH, entry.name),
          source: entry.name.replace('.log', ''),
        })
      } else if (entry.isDirectory()) {
        // Scan subdirectories (e.g., automation/)
        try {
          const subEntries = await readdir(join(LOGS_PATH, entry.name))
          for (const subFile of subEntries) {
            if (subFile.endsWith('.log')) {
              files.push({
                path: join(LOGS_PATH, entry.name, subFile),
                source: `${entry.name}/${subFile.replace('.log', '')}`,
              })
            }
          }
        } catch {
          // Skip unreadable subdirectories
        }
      }
    }
  } catch {
    // Logs directory doesn't exist or isn't readable
  }

  return files
}

async function readLogFile(filePath: string, source: string, maxLines: number): Promise<LogEntry[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split('\n').slice(-maxLines)
    const entries: LogEntry[] = []

    for (const line of lines) {
      const entry = parseLogLine(line, source)
      if (entry) entries.push(entry)
    }

    return entries
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'recent'
    const limit = parseInt(searchParams.get('limit') || '100')
    const level = searchParams.get('level')
    const session = searchParams.get('session')
    const search = searchParams.get('search')
    const source = searchParams.get('source')

    if (action === 'recent') {
      const logFiles = await discoverLogFiles()
      let logs: LogEntry[] = []

      // Read from all discovered log files
      for (const file of logFiles) {
        if (source && file.source !== source) continue
        const entries = await readLogFile(file.path, file.source, 200)
        logs.push(...entries)
      }

      // Sort newest first
      logs.sort((a, b) => b.timestamp - a.timestamp)

      // Apply filters
      if (level) {
        logs = logs.filter(log => log.level === level)
      }
      if (session) {
        logs = logs.filter(log => log.session?.includes(session))
      }
      if (search) {
        const searchLower = search.toLowerCase()
        logs = logs.filter(log =>
          log.message.toLowerCase().includes(searchLower) ||
          log.source.toLowerCase().includes(searchLower)
        )
      }

      logs = logs.slice(0, limit)
      return NextResponse.json({ logs })
    }

    if (action === 'sources') {
      const logFiles = await discoverLogFiles()
      const sources = logFiles.map(f => f.source)
      return NextResponse.json({ sources })
    }

    if (action === 'tail') {
      const sinceTimestamp = parseInt(searchParams.get('since') || '0')
      const logFiles = await discoverLogFiles()
      let logs: LogEntry[] = []

      for (const file of logFiles) {
        if (source && file.source !== source) continue
        const entries = await readLogFile(file.path, file.source, 50)
        logs.push(...entries.filter(e => e.timestamp > sinceTimestamp))
      }

      logs.sort((a, b) => b.timestamp - a.timestamp)
      logs = logs.slice(0, limit)
      return NextResponse.json({ logs })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Logs API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { action, message, level, source: customSource, session } = await request.json()

    if (action === 'add') {
      if (!message) {
        return NextResponse.json({ error: 'Message required' }, { status: 400 })
      }

      const logEntry: LogEntry = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        level: level || 'info',
        source: customSource || 'mission-control',
        session,
        message,
        data: null,
      }

      return NextResponse.json({ success: true, entry: logEntry })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Logs API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
