import net from 'node:net'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { config } from './config'

export interface GatewayDeliveryStatus {
  portListening: boolean
  commandAvailable: boolean
  canDeliver: boolean
  reason: string
  host: string
  port: number
}

function commandExists(bin: string): boolean {
  try {
    if (!bin) return false
    if (bin.includes('\\') || bin.includes('/') || /^[a-zA-Z]:/.test(bin)) {
      return existsSync(bin)
    }
    const checker = process.platform === 'win32' ? 'where' : 'which'
    const result = spawnSync(checker, [bin], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    return false
  }
}

export function isGatewayPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timeoutMs = 1500

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      cleanup()
      resolve(true)
    })
    socket.once('timeout', () => {
      cleanup()
      resolve(false)
    })
    socket.once('error', () => {
      cleanup()
      resolve(false)
    })
    socket.connect(port, host)
  })
}

export async function getGatewayDeliveryStatus(): Promise<GatewayDeliveryStatus> {
  const host = config.gatewayHost
  const port = config.gatewayPort
  const portListening = await isGatewayPortOpen(host, port)
  const commandAvailable = commandExists(config.openclawBin) || commandExists(config.clawdbotBin)

  let reason = 'Gateway delivery ready'
  if (!commandAvailable) {
    reason = `OpenClaw CLI not available (${config.openclawBin || 'openclaw'})`
  } else if (!portListening) {
    reason = `Gateway is not listening on ${host}:${port}`
  }

  return {
    portListening,
    commandAvailable,
    canDeliver: commandAvailable && portListening,
    reason,
    host,
    port,
  }
}
