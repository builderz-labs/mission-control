import { NextRequest, NextResponse } from 'next/server'
import { runCommand } from '@/lib/command'
import { requireRole } from '@/lib/auth'

interface CronJob {
  name: string
  schedule: string
  command: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  lastStatus?: 'success' | 'error' | 'running'
  lastError?: string
}

// Parse crontab format to extract schedule and command
function parseCronLine(line: string): Partial<CronJob> | null {
  // Skip comments and empty lines
  if (line.startsWith('#') || line.trim() === '') {
    return null
  }

  // Basic cron line format: minute hour day month dayOfWeek command
  const parts = line.split(' ')
  if (parts.length < 6) {
    return null
  }

  const schedule = parts.slice(0, 5).join(' ')
  const command = parts.slice(5).join(' ')
  
  // Extract job name from comment or command
  const name = extractJobName(command, line)
  
  return {
    name,
    schedule,
    command,
    enabled: true
  }
}

function extractJobName(command: string, fullLine: string): string {
  // Try to extract name from comment
  const commentMatch = fullLine.match(/#\s*([^#\n]+)$/)
  if (commentMatch) {
    return commentMatch[1].trim()
  }
  
  // Try to extract from command description
  const scriptMatch = command.match(/([^\/\s]+\.sh)/)
  if (scriptMatch) {
    return scriptMatch[1].replace('.sh', '')
  }
  
  // Fallback to first few words of command
  return command.split(' ').slice(0, 3).join(' ')
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    if (action === 'list') {
      // Get current user's crontab
      try {
        const { stdout } = await runCommand('crontab', ['-l'], { timeoutMs: 5000 })
        const lines = stdout.split('\n')
        
        const jobs: CronJob[] = lines
          .map(parseCronLine)
          .filter(Boolean)
          .map((job, index) => ({
            ...job,
            name: job!.name || `Job ${index + 1}`,
            lastRun: undefined, // Would need to check log files
            nextRun: calculateNextRun(job!.schedule!),
            lastStatus: undefined // Changed from 'unknown' to undefined
          })) as CronJob[]

        return NextResponse.json({ jobs })
      } catch (error: any) {
        if (error.message.includes('no crontab')) {
          return NextResponse.json({ jobs: [] })
        }
        throw error
      }
    }

    if (action === 'logs') {
      const jobName = searchParams.get('job')
      if (!jobName) {
        return NextResponse.json({ error: 'Job name required' }, { status: 400 })
      }

      try {
        // Check system logs for cron execution
        const { stdout } = await runCommand('grep', ['-h', '-F', jobName, '/var/log/syslog'], {
          timeoutMs: 5000
        })
        const tailLines = stdout.split('\n').slice(-20).join('\n')

        const logs = tailLines.split('\n')
          .filter(line => line.trim())
          .map(line => ({
            timestamp: extractTimestamp(line),
            message: line,
            level: line.includes('error') || line.includes('failed') ? 'error' : 'info'
          }))

        return NextResponse.json({ logs })
      } catch (error) {
        // If we can't access syslog, return empty logs
        return NextResponse.json({ logs: [] })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Cron API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { action, jobName, schedule, command, enabled } = await request.json()

    if (action === 'toggle') {
      if (!jobName) {
        return NextResponse.json({ error: 'Job name required' }, { status: 400 })
      }

      // Get current crontab
      let currentCrontab = ''
      try {
        const { stdout } = await runCommand('crontab', ['-l'])
        currentCrontab = stdout
      } catch (error) {
        // No existing crontab
      }

      const lines = currentCrontab.split('\n')
      const updatedLines = lines.map(line => {
        if (line.includes(jobName)) {
          if (enabled && line.startsWith('#')) {
            // Enable job by removing comment
            return line.substring(1).trim()
          } else if (!enabled && !line.startsWith('#')) {
            // Disable job by adding comment
            return '#' + line
          }
        }
        return line
      })

      // Write back to crontab
      const newCrontab = updatedLines.join('\n')
      await runCommand('crontab', ['-'], { input: newCrontab })

      return NextResponse.json({ success: true })
    }

    if (action === 'add') {
      if (!schedule || !command || !jobName) {
        return NextResponse.json(
          { error: 'Schedule, command, and job name required' },
          { status: 400 }
        )
      }

      // Get current crontab
      let currentCrontab = ''
      try {
        const { stdout } = await runCommand('crontab', ['-l'])
        currentCrontab = stdout
      } catch (error) {
        // No existing crontab
      }

      // Add new job
      const newJob = `${schedule} ${command} # ${jobName}`
      const newCrontab = currentCrontab + '\n' + newJob

      await runCommand('crontab', ['-'], { input: newCrontab })

      return NextResponse.json({ success: true })
    }

    if (action === 'remove') {
      if (!jobName) {
        return NextResponse.json({ error: 'Job name required' }, { status: 400 })
      }

      // Get current crontab
      let currentCrontab = ''
      try {
        const { stdout } = await runCommand('crontab', ['-l'])
        currentCrontab = stdout
      } catch (error) {
        return NextResponse.json({ error: 'No crontab found' }, { status: 404 })
      }

      // Remove lines containing the job name
      const lines = currentCrontab.split('\n')
      const filteredLines = lines.filter(line => !line.includes(jobName))
      const newCrontab = filteredLines.join('\n')

      await runCommand('crontab', ['-'], { input: newCrontab })

      return NextResponse.json({ success: true })
    }

    if (action === 'trigger') {
      if (!command) {
        return NextResponse.json({ error: 'Command required' }, { status: 400 })
      }
      if (process.env.MISSION_CONTROL_ALLOW_COMMAND_TRIGGER !== '1') {
        return NextResponse.json(
          { error: 'Manual triggers disabled. Set MISSION_CONTROL_ALLOW_COMMAND_TRIGGER=1 to enable.' },
          { status: 403 }
        )
      }

      // Execute the command manually
      try {
        const [cmd, ...args] = command.split(' ')
        if (!['openclaw', 'clawdbot'].includes(cmd)) {
          return NextResponse.json(
            { error: 'Only openclaw/clawdbot commands are allowed.' },
            { status: 400 }
          )
        }
        const { stdout, stderr } = await runCommand(cmd, args, {
          timeoutMs: 30000
        })

        return NextResponse.json({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        })
      } catch (execError: any) {
        return NextResponse.json({
          success: false,
          error: execError.message,
          stdout: execError.stdout?.trim() || '',
          stderr: execError.stderr?.trim() || ''
        }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Cron management error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function calculateNextRun(schedule: string): number {
  // This is a simplified calculation - in production you'd use a cron parser library
  // For now, just return a rough estimate
  const now = new Date()
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000) // Add 1 hour as estimate
  return nextHour.getTime()
}

function extractTimestamp(logLine: string): number {
  // Extract timestamp from syslog format
  const match = logLine.match(/^(\w+\s+\d+\s+\d{2}:\d{2}:\d{2})/)
  if (match) {
    const currentYear = new Date().getFullYear()
    const date = new Date(`${currentYear} ${match[1]}`)
    return date.getTime()
  }
  return Date.now()
}
