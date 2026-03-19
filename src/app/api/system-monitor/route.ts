import { NextRequest, NextResponse } from 'next/server'
import os from 'node:os'
import { runCommand } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [cpu, memory, disk, gpu, network, processes] = await Promise.all([
      getCpuSnapshot(),
      getMemorySnapshot(),
      getDiskSnapshot(),
      getGpuSnapshot(),
      getNetworkSnapshot(),
      getProcessSnapshot(),
    ])

    return NextResponse.json({
      timestamp: Date.now(),
      cpu,
      memory,
      disk,
      gpu,
      network,
      processes,
    })
  } catch (error) {
    logger.error({ err: error }, 'System monitor API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── CPU ─────────────────────────────────────────────────────────────────────

/** Sample CPU ticks twice ~100ms apart to compute instantaneous usage % */
async function getCpuSnapshot() {
  const cpus = os.cpus()
  const model = cpus[0]?.model || 'Unknown'
  const cores = cpus.length
  const loadAvg = os.loadavg() as [number, number, number]

  const sample1 = cpuTotals()
  await new Promise(r => setTimeout(r, 100))
  const sample2 = cpuTotals()

  const idleDelta = sample2.idle - sample1.idle
  const totalDelta = sample2.total - sample1.total
  const usagePercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0

  return { usagePercent, cores, model, loadAvg }
}

function cpuTotals() {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

// ── Memory ──────────────────────────────────────────────────────────────────

async function getMemorySnapshot() {
  const totalBytes = os.totalmem()
  let availableBytes = os.freemem()

  // More accurate available memory per platform
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('vm_stat', [], { timeoutMs: 3000 })
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/i)
      const pageSize = parseInt(pageSizeMatch?.[1] || '4096', 10)
      const pageLabels = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable']

      const availablePages = pageLabels.reduce((sum, label) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const match = stdout.match(new RegExp(`${escaped}:\\s+([\\d.]+)`, 'i'))
        const pages = parseInt((match?.[1] || '0').replace(/\./g, ''), 10)
        return sum + (Number.isFinite(pages) ? pages : 0)
      }, 0)

      const vmAvailable = availablePages * pageSize
      if (vmAvailable > 0) availableBytes = Math.min(vmAvailable, totalBytes)
    } catch { /* fallback to os.freemem() */ }
  } else {
    try {
      const { stdout } = await runCommand('free', ['-b'], { timeoutMs: 3000 })
      const memLine = stdout.split('\n').find(l => l.startsWith('Mem:'))
      if (memLine) {
        const parts = memLine.trim().split(/\s+/)
        const available = parseInt(parts[6] || parts[3] || '0', 10)
        if (Number.isFinite(available) && available > 0) {
          availableBytes = Math.min(available, totalBytes)
        }
      }
    } catch { /* fallback */ }
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes)
  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0

  // Swap
  let swapTotalBytes = 0
  let swapUsedBytes = 0

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('sysctl', ['-n', 'vm.swapusage'], { timeoutMs: 3000 })
      // Output: "total = 2048.00M  used = 1024.00M  free = 1024.00M  ..."
      const totalMatch = stdout.match(/total\s*=\s*([\d.]+)M/i)
      const usedMatch = stdout.match(/used\s*=\s*([\d.]+)M/i)
      if (totalMatch) swapTotalBytes = parseFloat(totalMatch[1]) * 1024 * 1024
      if (usedMatch) swapUsedBytes = parseFloat(usedMatch[1]) * 1024 * 1024
    } catch { /* no swap info */ }
  } else {
    try {
      const { stdout } = await runCommand('free', ['-b'], { timeoutMs: 3000 })
      const swapLine = stdout.split('\n').find(l => l.startsWith('Swap:'))
      if (swapLine) {
        const parts = swapLine.trim().split(/\s+/)
        swapTotalBytes = parseInt(parts[1] || '0', 10)
        swapUsedBytes = parseInt(parts[2] || '0', 10)
      }
    } catch { /* no swap info */ }
  }

  return { totalBytes, usedBytes, availableBytes, usagePercent, swapTotalBytes, swapUsedBytes }
}

// ── Disk ────────────────────────────────────────────────────────────────────

async function getDiskSnapshot() {
  const disks: Array<{
    mountpoint: string
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usagePercent: number
  }> = []

  try {
    const { stdout } = await runCommand('df', ['-k'], { timeoutMs: 3000 })
    const lines = stdout.trim().split('\n').slice(1) // skip header

    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 6) continue

      const mountpoint = parts[parts.length - 1]
      // Skip virtual/system filesystems
      if (mountpoint.startsWith('/dev') || mountpoint.startsWith('/System') ||
          mountpoint.startsWith('/private/var/vm') || mountpoint === '/boot/efi') continue
      // Only include real mounts
      if (!parts[0].startsWith('/') && !parts[0].includes(':')) continue

      const totalKB = parseInt(parts[1], 10)
      const usedKB = parseInt(parts[2], 10)
      const availableKB = parseInt(parts[3], 10)
      if (!Number.isFinite(totalKB) || totalKB <= 0) continue

      disks.push({
        mountpoint,
        totalBytes: totalKB * 1024,
        usedBytes: usedKB * 1024,
        availableBytes: availableKB * 1024,
        usagePercent: Math.round((usedKB / totalKB) * 100),
      })
    }
  } catch (err) {
    logger.error({ err }, 'Error reading disk info')
  }

  return disks
}

// ── GPU ─────────────────────────────────────────────────────────────────────

async function getGpuSnapshot(): Promise<Array<{
  name: string
  memoryTotalMB: number
  memoryUsedMB: number
  usagePercent: number
}> | null> {
  // Try NVIDIA first (Linux/macOS with discrete GPU)
  try {
    const { stdout, code } = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used',
      '--format=csv,noheader,nounits',
    ], { timeoutMs: 3000 })

    if (code === 0 && stdout.trim()) {
      const gpus = stdout.trim().split('\n').map(line => {
        const [name, totalStr, usedStr] = line.split(',').map(s => s.trim())
        const memoryTotalMB = parseInt(totalStr, 10)
        const memoryUsedMB = parseInt(usedStr, 10)
        return {
          name,
          memoryTotalMB,
          memoryUsedMB,
          usagePercent: memoryTotalMB > 0 ? Math.round((memoryUsedMB / memoryTotalMB) * 100) : 0,
        }
      })
      if (gpus.length > 0) return gpus
    }
  } catch { /* nvidia-smi not available */ }

  // macOS: system_profiler for GPU info (VRAM only, no live usage)
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('system_profiler', ['SPDisplaysDataType', '-json'], { timeoutMs: 5000 })
      const data = JSON.parse(stdout)
      const displays = data?.SPDisplaysDataType
      if (Array.isArray(displays)) {
        const gpus = displays.map((gpu: any) => {
          const name = gpu.sppci_model || 'Unknown GPU'
          // VRAM string like "8 GB" or "16384 MB"
          const vramStr: string = gpu.spdisplays_vram || gpu.spdisplays_vram_shared || ''
          let memoryTotalMB = 0
          const gbMatch = vramStr.match(/([\d.]+)\s*GB/i)
          const mbMatch = vramStr.match(/([\d.]+)\s*MB/i)
          if (gbMatch) memoryTotalMB = parseFloat(gbMatch[1]) * 1024
          else if (mbMatch) memoryTotalMB = parseFloat(mbMatch[1])

          return {
            name,
            memoryTotalMB: Math.round(memoryTotalMB),
            memoryUsedMB: 0, // macOS doesn't expose live GPU memory usage easily
            usagePercent: 0,
          }
        }).filter((g: any) => g.memoryTotalMB > 0)

        if (gpus.length > 0) return gpus
      }
    } catch { /* system_profiler failed */ }
  }

  return null
}

// ── Network ──────────────────────────────────────────────────────────────────

/** Return cumulative rx/tx byte counters per interface (stateless — frontend computes rates) */
async function getNetworkSnapshot(): Promise<Array<{
  interface: string
  rxBytes: number
  txBytes: number
}>> {
  // Linux: parse /proc/net/dev
  if (process.platform === 'linux') {
    try {
      const fs = await import('node:fs/promises')
      const content = await fs.readFile('/proc/net/dev', 'utf-8')
      const lines = content.trim().split('\n').slice(2) // skip 2 header lines

      const interfaces: Array<{ interface: string; rxBytes: number; txBytes: number }> = []
      for (const line of lines) {
        const [name, rest] = line.split(':')
        if (!name || !rest) continue
        const iface = name.trim()
        if (iface === 'lo') continue // skip loopback

        const cols = rest.trim().split(/\s+/)
        const rxBytes = parseInt(cols[0], 10)
        const txBytes = parseInt(cols[8], 10)
        if (Number.isFinite(rxBytes) && Number.isFinite(txBytes)) {
          interfaces.push({ interface: iface, rxBytes, txBytes })
        }
      }
      return interfaces
    } catch { /* fallthrough to empty */ }
  }

  // macOS: parse netstat -ib
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('netstat', ['-ib'], { timeoutMs: 3000 })
      const lines = stdout.trim().split('\n')
      if (lines.length < 2) return []

      // Find column indices from header
      const header = lines[0]
      const cols = header.split(/\s+/)
      const nameIdx = 0
      const ibytesIdx = cols.indexOf('Ibytes')
      const obytesIdx = cols.indexOf('Obytes')
      if (ibytesIdx === -1 || obytesIdx === -1) return []

      // Deduplicate: keep highest counters per interface (multiple address families)
      const ifaceMap = new Map<string, { rxBytes: number; txBytes: number }>()

      for (const line of lines.slice(1)) {
        const parts = line.split(/\s+/)
        const iface = parts[nameIdx]
        if (!iface || iface === 'lo0') continue

        const rxBytes = parseInt(parts[ibytesIdx], 10)
        const txBytes = parseInt(parts[obytesIdx], 10)
        if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue

        const existing = ifaceMap.get(iface)
        if (!existing || rxBytes > existing.rxBytes) {
          ifaceMap.set(iface, { rxBytes, txBytes })
        }
      }

      return Array.from(ifaceMap.entries()).map(([iface, data]) => ({
        interface: iface,
        ...data,
      }))
    } catch { /* fallthrough */ }
  }

  return []
}

// ── Processes ────────────────────────────────────────────────────────────────

const MAX_PROCESSES = 8

/** Return top processes by CPU usage (normalized to 0-100%) */
async function getProcessSnapshot(): Promise<Array<{
  pid: number
  name: string
  cpuPercent: number
  memPercent: number
  memBytes: number
}>> {
  const coreCount = os.cpus().length || 1

  function parsePsOutput(stdout: string) {
    const lines = stdout.trim().split('\n').slice(1) // skip header
    const results: Array<{
      pid: number
      name: string
      cpuPercent: number
      memPercent: number
      memBytes: number
    }> = []

    for (const line of lines) {
      const parts = line.trim().split(/\s+/, 4)
      const rest = line.trim().split(/\s+/).slice(4).join(' ')
      if (parts.length < 4 || !rest) continue

      const pid = parseInt(parts[0], 10)
      const rawCpu = parseFloat(parts[1])
      const memPercent = parseFloat(parts[2])
      const rssKB = parseInt(parts[3], 10)
      if (!Number.isFinite(pid)) continue

      // Get just the command name (last path segment)
      const name = rest.split('/').pop() || rest

      // Filter out the ps command itself
      if (name === 'ps') continue

      results.push({
        pid,
        name,
        // Normalize: ps reports per-core %, so 200% on 4 cores = 50% total
        cpuPercent: Number.isFinite(rawCpu) ? Math.round((rawCpu / coreCount) * 10) / 10 : 0,
        memPercent: Number.isFinite(memPercent) ? memPercent : 0,
        memBytes: Number.isFinite(rssKB) ? rssKB * 1024 : 0,
      })
    }

    return results
  }

  try {
    // Linux ps supports --sort
    const { stdout } = await runCommand('ps', [
      'axo', 'pid,pcpu,pmem,rss,comm',
      '--sort=-pcpu',
    ], { timeoutMs: 3000 })

    return parsePsOutput(stdout).slice(0, MAX_PROCESSES)
  } catch {
    // macOS ps doesn't support --sort, sort manually
    try {
      const { stdout } = await runCommand('ps', [
        'axo', 'pid,pcpu,pmem,rss,comm',
      ], { timeoutMs: 3000 })

      const parsed = parsePsOutput(stdout)
      parsed.sort((a, b) => b.cpuPercent - a.cpuPercent)
      return parsed.slice(0, MAX_PROCESSES)
    } catch {
      return []
    }
  }
}
