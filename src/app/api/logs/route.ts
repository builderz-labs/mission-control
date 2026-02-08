import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { config } from '@/lib/config'
import { runCommand } from '@/lib/command'
import { requireRole } from '@/lib/auth'

const LOGS_PATH = config.logsDir
const TEMP_LOGS_PATH = config.tempLogsDir

interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: any
}

function parseLogLine(line: string, source: string): LogEntry | null {
  if (!line.trim()) return null

  try {
    // Try to parse as JSON first (structured logs)
    if (line.startsWith('{')) {
      const parsed = JSON.parse(line)
      return {
        id: `${source}-${Date.now()}-${Math.random()}`,
        timestamp: parsed.timestamp || Date.now(),
        level: parsed.level || 'info',
        source: parsed.source || source,
        session: parsed.session,
        message: parsed.message || line,
        data: parsed.data
      }
    }

    // Parse plain text logs with common patterns
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)/)
    const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG)\]/i) || line.match(/(ERROR|WARN|INFO|DEBUG):/i)
    const sessionMatch = line.match(/session[:\s]+([^\s]+)/i)

    let timestamp = Date.now()
    if (timestampMatch) {
      timestamp = new Date(timestampMatch[1]).getTime()
    }

    let level: LogEntry['level'] = 'info'
    if (levelMatch) {
      level = levelMatch[1].toLowerCase() as LogEntry['level']
    } else if (line.toLowerCase().includes('error')) {
      level = 'error'
    } else if (line.toLowerCase().includes('warn')) {
      level = 'warn'
    } else if (line.toLowerCase().includes('debug')) {
      level = 'debug'
    }

    return {
      id: `${source}-${timestamp}-${Math.random()}`,
      timestamp,
      level,
      source,
      session: sessionMatch?.[1],
      message: line,
      data: null
    }
  } catch (error) {
    // If parsing fails, create a basic log entry
    return {
      id: `${source}-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      level: 'info',
      source,
      message: line,
      data: null
    }
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
      // Get recent logs from various sources
      const logs: LogEntry[] = []

      try {
        // Read ClawdBot logs
        const today = new Date().toISOString().split('T')[0]
        const clawdbotLogPath = TEMP_LOGS_PATH
          ? join(TEMP_LOGS_PATH, `clawdbot-${today}.log`)
          : ''
        
        try {
          if (clawdbotLogPath) {
            const content = await readFile(clawdbotLogPath, 'utf-8')
            const lines = content.split('\n').slice(-500) // Last 500 lines
            
            lines.forEach(line => {
              const entry = parseLogLine(line, 'clawdbot')
              if (entry) logs.push(entry)
            })
          }
        } catch (fileError) {
          // File might not exist, continue
        }

        // Read application logs if they exist
        try {
          if (LOGS_PATH) {
            const appLogsPath = join(LOGS_PATH, 'application.log')
            const content = await readFile(appLogsPath, 'utf-8')
            const lines = content.split('\n').slice(-200)
            
            lines.forEach(line => {
              const entry = parseLogLine(line, 'application')
              if (entry) logs.push(entry)
            })
          }
        } catch (fileError) {
          // File might not exist, continue
        }

        // Read system logs for cron jobs
        try {
          const { stdout } = await runCommand('tail', ['-n', '200', '/var/log/syslog'], {
            timeoutMs: 3000
          })
          
          stdout.split('\n').forEach((line: string) => {
            if (line.includes('CRON') || line.includes('clawdbot')) {
              const entry = parseLogLine(line, 'system')
              if (entry) logs.push(entry)
            }
          })
        } catch (syslogError) {
          // System logs might not be accessible, continue
        }

      } catch (error) {
        console.error('Error reading logs:', error)
      }

      // Sort by timestamp (newest first)
      logs.sort((a, b) => b.timestamp - a.timestamp)

      // Apply filters
      let filteredLogs = logs

      if (level) {
        filteredLogs = filteredLogs.filter(log => log.level === level)
      }

      if (session) {
        filteredLogs = filteredLogs.filter(log => log.session?.includes(session))
      }

      if (search) {
        const searchLower = search.toLowerCase()
        filteredLogs = filteredLogs.filter(log => 
          log.message.toLowerCase().includes(searchLower) ||
          log.source.toLowerCase().includes(searchLower)
        )
      }

      if (source) {
        filteredLogs = filteredLogs.filter(log => log.source === source)
      }

      // Limit results
      filteredLogs = filteredLogs.slice(0, limit)

      return NextResponse.json({ logs: filteredLogs })
    }

    if (action === 'sources') {
      // Get available log sources
      const sources: string[] = ['clawdbot', 'system']

      try {
        if (LOGS_PATH) {
          const files = await readdir(LOGS_PATH)
          files.forEach(file => {
            if (file.endsWith('.log')) {
              sources.push(file.replace('.log', ''))
            }
          })
        }
      } catch (error) {
        // Logs directory might not exist
      }

      return NextResponse.json({ sources: Array.from(new Set(sources)) })
    }

    if (action === 'tail') {
      // Get real-time logs (last few entries)
      const sinceTimestamp = parseInt(searchParams.get('since') || '0')
      const logs: LogEntry[] = []

      try {
        const today = new Date().toISOString().split('T')[0]
        const clawdbotLogPath = TEMP_LOGS_PATH
          ? join(TEMP_LOGS_PATH, `clawdbot-${today}.log`)
          : ''
        
        if (clawdbotLogPath) {
          const content = await readFile(clawdbotLogPath, 'utf-8')
          const lines = content.split('\n').slice(-50) // Last 50 lines
          
          lines.forEach(line => {
            const entry = parseLogLine(line, 'clawdbot')
            if (entry && entry.timestamp > sinceTimestamp) {
              logs.push(entry)
            }
          })
        }
      } catch (error) {
        // File might not exist
      }

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
    const { action, message, level, source, session } = await request.json()

    if (action === 'add') {
      // Add a custom log entry (useful for debugging or manual entries)
      if (!message) {
        return NextResponse.json({ error: 'Message required' }, { status: 400 })
      }

      const logEntry: LogEntry = {
        id: `custom-${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        level: level || 'info',
        source: source || 'mission-control',
        session,
        message,
        data: null
      }

      // In a real implementation, you'd write this to a log file
      // For now, we'll just return success
      return NextResponse.json({ success: true, entry: logEntry })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Logs API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
