import { NextRequest, NextResponse } from 'next/server'
import { runClawdbot } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { heavyLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, spawnAgentSchema } from '@/lib/validation'

function getPreferredToolsProfile(): string {
  return String(process.env.OPENCLAW_TOOLS_PROFILE || 'coding').trim() || 'coding'
}

async function runSpawnWithCompatibility(spawnPayload: Record<string, unknown>) {
  // The sessions_spawn command starts an agent session which can take 30-120 seconds
  // to spin up (model download, initialisation, etc.).  Use a generous timeout so we
  // don't kill the spawn process before the session is established.
  return runClawdbot(['sessions_spawn', JSON.stringify(spawnPayload)], { timeoutMs: 120_000 })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, spawnAgentSchema)
    if ('error' in result) return result.error
    const { task, model, label, timeoutSeconds } = result.data

    const timeout = timeoutSeconds

    // Generate spawn ID
    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Construct the spawn command
    // Using OpenClaw's sessions_spawn function via clawdbot CLI
    const spawnPayload = {
      task,
      model,
      label,
      runTimeoutSeconds: timeout,
      tools: {
        profile: getPreferredToolsProfile(),
      },
    }

    try {
      // Execute the spawn command (OpenClaw 2026.3.2+ defaults tools.profile to messaging).
      let stdout = ''
      let stderr = ''
      let compatibilityFallbackUsed = false
      try {
        const result = await runSpawnWithCompatibility(spawnPayload)
        stdout = result.stdout
        stderr = result.stderr
      } catch (firstError: any) {
        const rawErr = String(firstError?.stderr || firstError?.message || '').toLowerCase()
        const likelySchemaMismatch =
          rawErr.includes('unknown field') ||
          rawErr.includes('unknown key') ||
          rawErr.includes('invalid argument') ||
          rawErr.includes('tools') ||
          rawErr.includes('profile')
        if (!likelySchemaMismatch) throw firstError

        const fallbackPayload = { ...spawnPayload }
        delete (fallbackPayload as any).tools
        const fallback = await runSpawnWithCompatibility(fallbackPayload)
        stdout = fallback.stdout
        stderr = fallback.stderr
        compatibilityFallbackUsed = true
      }

      // Parse the response to extract session info
      let sessionInfo = null
      try {
        // Look for session information in stdout
        const sessionMatch = stdout.match(/Session created: (.+)/)
        if (sessionMatch) {
          sessionInfo = sessionMatch[1]
        }
      } catch (parseError) {
        logger.error({ err: parseError }, 'Failed to parse session info')
      }

      return NextResponse.json({
        success: true,
        spawnId,
        sessionInfo,
        task,
        model,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now(),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        compatibility: {
          toolsProfile: getPreferredToolsProfile(),
          fallbackUsed: compatibilityFallbackUsed,
        },
      })

    } catch (execError: any) {
      logger.error({ err: execError }, 'Spawn execution error')
      
      return NextResponse.json({
        success: false,
        spawnId,
        error: execError.message || 'Failed to spawn agent',
        task,
        model,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now()
      }, { status: 500 })
    }

  } catch (error) {
    logger.error({ err: error }, 'Spawn API error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Get spawn history
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    // In a real implementation, you'd store spawn history in a database
    // For now, we'll try to read recent spawn activity from logs
    
    try {
      if (!config.logsDir) {
        return NextResponse.json({ history: [] })
      }

      const files = await readdir(config.logsDir)
      const logFiles = await Promise.all(
        files
          .filter((file) => file.endsWith('.log'))
          .map(async (file) => {
            const fullPath = join(config.logsDir, file)
            const stats = await stat(fullPath)
            return { file, fullPath, mtime: stats.mtime.getTime() }
          })
      )

      const recentLogs = logFiles
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 5)

      const lines: string[] = []

      for (const log of recentLogs) {
        const content = await readFile(log.fullPath, 'utf-8')
        const matched = content
          .split('\n')
          .filter((line) => line.includes('sessions_spawn'))
        lines.push(...matched)
      }

      const spawnHistory = lines
        .slice(-limit)
        .map((line, index) => {
          try {
            const timestampMatch = line.match(
              /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
            )
            const modelMatch = line.match(/model[:\s]+"([^"]+)"/)
            const taskMatch = line.match(/task[:\s]+"([^"]+)"/)

            return {
              id: `history-${Date.now()}-${index}`,
              timestamp: timestampMatch
                ? new Date(timestampMatch[1]).getTime()
                : Date.now(),
              model: modelMatch ? modelMatch[1] : 'unknown',
              task: taskMatch ? taskMatch[1] : 'unknown',
              status: 'completed',
              line: line.trim()
            }
          } catch (parseError) {
            return null
          }
        })
        .filter(Boolean)

      return NextResponse.json({ history: spawnHistory })

    } catch (logError) {
      // If we can't read logs, return empty history
      return NextResponse.json({ history: [] })
    }

  } catch (error) {
    logger.error({ err: error }, 'Spawn history API error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
