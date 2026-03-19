import { NextRequest, NextResponse } from 'next/server'
import os from 'node:os'
import { runCommand } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const [cpu, memory, disk, gpu] = await Promise.all([
      getCpuSnapshot(),
      getMemorySnapshot(),
      getDiskSnapshot(),
      getGpuSnapshot(),
    ])

    return NextResponse.json({
      timestamp: Date.now(),
      cpu,
      memory,
      disk,
      gpu,
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
