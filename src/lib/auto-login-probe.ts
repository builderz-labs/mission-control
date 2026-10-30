import net from 'node:net'
import os from 'node:os'

/**
 * Auto-login is only safe while the server is unreachable from outside this
 * machine. `--hostname 127.0.0.1` is configuration, and configuration can be
 * stale or overridden, so the gate measures instead: it tries to open a socket
 * to this app's own port on every non-loopback interface address. Any address
 * that accepts means the port is exposed beyond this machine.
 */

export interface ProbeOptions {
  addresses?: string[]
  timeoutMs?: number
}

function isPrivateHostAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value.startsWith('127.')) return true
  if (value === '::1') return true
  // Link-local IPv6 carries a scope id that node:net needs separately.
  if (value.startsWith('fe80')) return true
  return false
}

export function nonLoopbackAddresses(): string[] {
  const found: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (isPrivateHostAddress(entry.address)) continue
      found.push(entry.address)
    }
  }
  return [...new Set(found)]
}

function canConnect(address: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port })
    let settled = false
    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

export async function findExposedAddresses(port: number, options: ProbeOptions = {}): Promise<string[]> {
  const addresses = options.addresses ?? nonLoopbackAddresses()
  const timeoutMs = options.timeoutMs ?? 500
  const results = await Promise.all(
    addresses.map(async (address) => ({ address, reachable: await canConnect(address, port, timeoutMs) })),
  )
  return results.filter((entry) => entry.reachable).map((entry) => entry.address)
}
