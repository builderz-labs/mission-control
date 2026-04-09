import net from 'node:net'
import { runCommand, runOpenClaw, runClawdbot } from '@/lib/command'
import { config } from '@/lib/config'
import { getAllModels } from '@/lib/models'
import { logger } from '@/lib/logger'

export interface GatewayStatus {
  running: boolean
  port: number
  pid: string | null
  uptime: number
  version: string | null
  connections: number
  port_listening?: boolean
}

export function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timeoutMs = 1500

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs)

    socket.once('connect', () => { cleanup(); resolve(true) })
    socket.once('timeout', () => { cleanup(); resolve(false) })
    socket.once('error', () => { cleanup(); resolve(false) })

    socket.connect(port, host)
  })
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const gatewayStatus: GatewayStatus = {
    running: false,
    port: config.gatewayPort,
    pid: null,
    uptime: 0,
    version: null,
    connections: 0
  }

  try {
    const { stdout } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 })
    const match = stdout
      .split('\n')
      .find((line) => /clawdbot-gateway|openclaw-gateway|openclaw.*gateway/i.test(line))
    if (match) {
      const parts = match.trim().split(/\s+/)
      gatewayStatus.running = true
      gatewayStatus.pid = parts[0]
    }
  } catch {
    // Gateway not running
  }

  try {
    gatewayStatus.port_listening = await isPortOpen(config.gatewayHost, config.gatewayPort)
  } catch (error) {
    logger.error({ err: error }, 'Error checking port')
  }

  try {
    const { stdout } = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    gatewayStatus.version = stdout.trim()
  } catch {
    try {
      const { stdout } = await runClawdbot(['--version'], { timeoutMs: 3000 })
      gatewayStatus.version = stdout.trim()
    } catch {
      gatewayStatus.version = 'unknown'
    }
  }

  return gatewayStatus
}

export async function getAvailableModels(): Promise<ReturnType<typeof getAllModels>> {
  // Model catalog is the single source of truth
  const models = [...getAllModels()]

  try {
    // Check which Ollama models are available locally
    const { stdout: ollamaOutput } = await runCommand('ollama', ['list'], { timeoutMs: 5000 })
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
          costPer1kInput: 0.0,
          costPer1kOutput: 0.0,
          maxContextTokens: 128000,
          size: parts[1] || 'unknown'
        }
      })

    ollamaModels.forEach(model => {
      if (!models.find(m => m.name === model.name)) {
        models.push(model)
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'Error checking Ollama models')
  }

  return models
}
