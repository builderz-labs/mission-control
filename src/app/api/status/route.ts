import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'

const execAsync = promisify(exec)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    if (action === 'overview') {
      const status = await getSystemStatus()
      return NextResponse.json(status)
    }

    if (action === 'gateway') {
      const gatewayStatus = await getGatewayStatus()
      return NextResponse.json(gatewayStatus)
    }

    if (action === 'models') {
      const models = await getAvailableModels()
      return NextResponse.json({ models })
    }

    if (action === 'health') {
      const health = await performHealthCheck()
      return NextResponse.json(health)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Status API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function getSystemStatus() {
  const status: any = {
    timestamp: Date.now(),
    uptime: 0,
    memory: { total: 0, used: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0 },
    sessions: { total: 0, active: 0 },
    processes: []
  }

  try {
    // System uptime
    const { stdout: uptimeOutput } = await execAsync('uptime -s', { timeout: 3000 })
    const bootTime = new Date(uptimeOutput.trim())
    status.uptime = Date.now() - bootTime.getTime()
  } catch (error) {
    console.error('Error getting uptime:', error)
  }

  try {
    // Memory info
    const { stdout: memOutput } = await execAsync('free -m', { timeout: 3000 })
    const memLines = memOutput.split('\n')
    const memLine = memLines.find(line => line.startsWith('Mem:'))
    if (memLine) {
      const parts = memLine.split(/\s+/)
      status.memory = {
        total: parseInt(parts[1]) || 0,
        used: parseInt(parts[2]) || 0,
        available: parseInt(parts[6]) || 0
      }
    }
  } catch (error) {
    console.error('Error getting memory info:', error)
  }

  try {
    // Disk info
    const { stdout: diskOutput } = await execAsync('df -h / | tail -n 1', { timeout: 3000 })
    const diskParts = diskOutput.split(/\s+/)
    if (diskParts.length >= 4) {
      status.disk = {
        total: diskParts[1],
        used: diskParts[2],
        available: diskParts[3],
        usage: diskParts[4]
      }
    }
  } catch (error) {
    console.error('Error getting disk info:', error)
  }

  try {
    // ClawdBot processes
    const { stdout: processOutput } = await execAsync('ps aux | grep -E "(clawdbot|openclaw)" | grep -v grep', { timeout: 3000 })
    const processes = processOutput.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/)
        return {
          pid: parts[1],
          cpu: parts[2],
          memory: parts[3],
          command: parts.slice(10).join(' ')
        }
      })
    status.processes = processes
  } catch (error) {
    console.error('Error getting process info:', error)
  }

  try {
    // Get sessions from gateway
    const { stdout: sessionsOutput } = await execAsync('openclaw sessions --json', { timeout: 5000 })
    const sessionsData = JSON.parse(sessionsOutput)
    
    if (sessionsData && Array.isArray(sessionsData.sessions)) {
      status.sessions = {
        total: sessionsData.sessions.length,
        active: sessionsData.sessions.filter((s: any) => {
          // Consider session active if updated within last hour
          const lastUpdate = new Date(s.lastActivity || s.updated_at || 0).getTime()
          const hourAgo = Date.now() - (60 * 60 * 1000)
          return lastUpdate > hourAgo
        }).length
      }
    }
  } catch (error) {
    console.error('Error getting sessions from gateway:', error)
    // Keep default values if gateway query fails
  }

  return status
}

async function getGatewayStatus() {
  const gatewayStatus: any = {
    running: false,
    port: 18789,
    pid: null,
    uptime: 0,
    version: null,
    connections: 0
  }

  try {
    // Check if gateway is running
    const { stdout } = await execAsync('ps aux | grep clawdbot-gateway | grep -v grep', { timeout: 3000 })
    if (stdout.trim()) {
      gatewayStatus.running = true
      const parts = stdout.split(/\s+/)
      gatewayStatus.pid = parts[1]
    }
  } catch (error) {
    // Gateway not running
  }

  try {
    // Check if port is listening
    const { stdout } = await execAsync('netstat -tlnp 2>/dev/null | grep :18789 || ss -tlnp | grep :18789', { timeout: 3000 })
    if (stdout.includes('18789')) {
      gatewayStatus.port_listening = true
    }
  } catch (error) {
    console.error('Error checking port:', error)
  }

  try {
    // Try to get version from config or binary
    const { stdout } = await execAsync('clawdbot --version 2>/dev/null || echo "unknown"', { timeout: 3000 })
    gatewayStatus.version = stdout.trim()
  } catch (error) {
    gatewayStatus.version = 'unknown'
  }

  return gatewayStatus
}

async function getAvailableModels() {
  // This would typically query the gateway or config files
  // For now, return the models from AGENTS.md
  const models = [
    { alias: 'haiku', name: 'anthropic/claude-3-5-haiku-latest', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1k: 0.25 },
    { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', description: 'Standard workhorse', costPer1k: 3.0 },
    { alias: 'opus', name: 'anthropic/claude-opus-4-5', provider: 'anthropic', description: 'Premium quality', costPer1k: 15.0 },
    { alias: 'deepseek', name: 'ollama/deepseek-r1:14b', provider: 'ollama', description: 'Local reasoning (free)', costPer1k: 0.0 },
    { alias: 'groq-fast', name: 'groq/llama-3.1-8b-instant', provider: 'groq', description: '840 tok/s, ultra fast', costPer1k: 0.05 },
    { alias: 'groq', name: 'groq/llama-3.3-70b-versatile', provider: 'groq', description: 'Fast + quality balance', costPer1k: 0.59 },
    { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Alternative provider', costPer1k: 1.0 },
    { alias: 'minimax', name: 'minimax/minimax-m2.1', provider: 'minimax', description: 'Cost-effective (1/10th price), strong coding', costPer1k: 0.3 },
  ]

  try {
    // Check which Ollama models are available locally
    const { stdout: ollamaOutput } = await execAsync('ollama list 2>/dev/null', { timeout: 5000 })
    const ollamaModels = ollamaOutput.split('\n')
      .slice(1) // Skip header
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/)
        return {
          alias: parts[0],
          name: `ollama/${parts[0]}`,
          provider: 'ollama',
          description: 'Local model',
          costPer1k: 0.0,
          size: parts[1] || 'unknown'
        }
      })

    // Add Ollama models that aren't already in the list
    ollamaModels.forEach(model => {
      if (!models.find(m => m.name === model.name)) {
        models.push(model)
      }
    })
  } catch (error) {
    console.error('Error checking Ollama models:', error)
  }

  return models
}

async function performHealthCheck() {
  const health: any = {
    overall: 'healthy',
    checks: [],
    timestamp: Date.now()
  }

  // Check gateway connection
  try {
    const gatewayStatus = await getGatewayStatus()
    health.checks.push({
      name: 'Gateway',
      status: gatewayStatus.running ? 'healthy' : 'unhealthy',
      message: gatewayStatus.running ? 'Gateway is running' : 'Gateway is not running'
    })
  } catch (error) {
    health.checks.push({
      name: 'Gateway',
      status: 'error',
      message: 'Failed to check gateway status'
    })
  }

  // Check disk space
  try {
    const { stdout } = await execAsync('df / | tail -n 1', { timeout: 3000 })
    const parts = stdout.split(/\s+/)
    const usagePercent = parseInt(parts[4]?.replace('%', '') || '0')
    
    health.checks.push({
      name: 'Disk Space',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Disk usage: ${usagePercent}%`
    })
  } catch (error) {
    health.checks.push({
      name: 'Disk Space',
      status: 'error',
      message: 'Failed to check disk space'
    })
  }

  // Check memory usage
  try {
    const { stdout } = await execAsync('free | grep Mem', { timeout: 3000 })
    const parts = stdout.split(/\s+/)
    const total = parseInt(parts[1])
    const available = parseInt(parts[6])
    const usagePercent = Math.round(((total - available) / total) * 100)

    health.checks.push({
      name: 'Memory Usage',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Memory usage: ${usagePercent}%`
    })
  } catch (error) {
    health.checks.push({
      name: 'Memory Usage',
      status: 'error',
      message: 'Failed to check memory usage'
    })
  }

  // Determine overall health
  const hasError = health.checks.some((check: any) => check.status === 'error')
  const hasCritical = health.checks.some((check: any) => check.status === 'critical')
  const hasWarning = health.checks.some((check: any) => check.status === 'warning')

  if (hasError || hasCritical) {
    health.overall = 'unhealthy'
  } else if (hasWarning) {
    health.overall = 'warning'
  }

  return health
}