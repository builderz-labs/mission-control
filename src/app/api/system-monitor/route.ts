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

interface CpuExtras {
  physicalCores: number | null
  threads: number | null
  currentClockMHz: number | null
  maxClockMHz: number | null
  temperatureC: number | null
  perCoreTemperaturesC: number[] | null
}

/** Sample CPU ticks twice ~100ms apart to compute instantaneous usage % */
async function getCpuSnapshot() {
  const cpus = os.cpus()
  const model = cpus[0]?.model || 'Unknown'
  const cores = cpus.length
  const loadAvg = os.loadavg() as [number, number, number]

  const sample1 = cpuTotals()
  // Run extras gathering concurrently with the 100ms sample window so we don't
  // pay an extra full second of latency for the panel.
  const extrasPromise = getCpuExtras()
  await new Promise(r => setTimeout(r, 100))
  const sample2 = cpuTotals()

  const idleDelta = sample2.idle - sample1.idle
  const totalDelta = sample2.total - sample1.total
  const usagePercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0

  const extras = await extrasPromise
  return { usagePercent, cores, model, loadAvg, ...extras }
}

async function getCpuExtras(): Promise<CpuExtras> {
  const empty: CpuExtras = {
    physicalCores: null,
    threads: null,
    currentClockMHz: null,
    maxClockMHz: null,
    temperatureC: null,
    perCoreTemperaturesC: null,
  }

  if (process.platform === 'win32') {
    let physicalCores: number | null = null
    let threads: number | null = null
    let currentClockMHz: number | null = null
    let maxClockMHz: number | null = null
    let temperatureC: number | null = null
    let perCoreTemperaturesC: number[] | null = null

    // Win32_Processor: cores, clocks
    try {
      const ps = `Get-CimInstance Win32_Processor | Select-Object @{N='cores';E={[int]$_.NumberOfCores}}, @{N='threads';E={[int]$_.NumberOfLogicalProcessors}}, @{N='current';E={[int]$_.CurrentClockSpeed}}, @{N='max';E={[int]$_.MaxClockSpeed}} | ConvertTo-Json -Compress`
      const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', ps], { timeoutMs: 4000 })
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout)
        // Sum across all sockets (most desktops/laptops have one)
        const arr = Array.isArray(parsed) ? parsed : [parsed]
        physicalCores = arr.reduce((a, p) => a + (Number.isFinite(p.cores) ? p.cores : 0), 0) || null
        threads = arr.reduce((a, p) => a + (Number.isFinite(p.threads) ? p.threads : 0), 0) || null
        currentClockMHz = Number.isFinite(arr[0]?.current) ? arr[0].current : null
        maxClockMHz = Number.isFinite(arr[0]?.max) ? arr[0].max : null
      }
    } catch { /* leave nulls */ }

    // LibreHardwareMonitor (when running with WMI export): real CPU temperatures
    try {
      const ps = `Get-CimInstance -Namespace 'root/LibreHardwareMonitor' -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Parent -like '/intelcpu/*' -or $_.Parent -like '/amdcpu/*' -or $_.Parent -like '/cpu/*' } | Select-Object @{N='name';E={[string]$_.Name}}, @{N='value';E={[double]$_.Value}} | ConvertTo-Json -Compress`
      const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', ps], { timeoutMs: 4000 })
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout)
        const sensors = (Array.isArray(parsed) ? parsed : [parsed]).filter((s: any) => Number.isFinite(s.value))
        // Prefer the package/Tctl/Tdie reading; fall back to max core temp.
        const pkg = sensors.find((s: any) => /package|tctl|tdie|cpu/i.test(s.name) && !/core\s*#/i.test(s.name))
        const cores = sensors.filter((s: any) => /core\s*#?\d+/i.test(s.name))
        if (pkg) temperatureC = Math.round(pkg.value * 10) / 10
        else if (cores.length > 0) temperatureC = Math.round(Math.max(...cores.map((c: any) => c.value)) * 10) / 10
        if (cores.length > 0) {
          perCoreTemperaturesC = cores.map((c: any) => Math.round(c.value * 10) / 10)
        }
      }
    } catch { /* LHM not running or not elevated; CPU temp stays null */ }

    return { physicalCores, threads, currentClockMHz, maxClockMHz, temperatureC, perCoreTemperaturesC }
  }

  if (process.platform === 'linux') {
    let temperatureC: number | null = null
    let currentClockMHz: number | null = null
    try {
      const fs = await import('node:fs/promises')
      // /sys/class/thermal/thermal_zone*: pick the highest reading across CPU-typed zones
      const entries = await fs.readdir('/sys/class/thermal').catch(() => [] as string[])
      const zoneFiles = entries.filter(e => e.startsWith('thermal_zone'))
      let maxC = -Infinity
      for (const zone of zoneFiles) {
        try {
          const type = (await fs.readFile(`/sys/class/thermal/${zone}/type`, 'utf-8')).trim()
          if (!/cpu|x86|coretemp|k10temp|tctl|package/i.test(type)) continue
          const tempRaw = (await fs.readFile(`/sys/class/thermal/${zone}/temp`, 'utf-8')).trim()
          // Linux reports millidegrees Celsius
          const tempC = parseInt(tempRaw, 10) / 1000
          if (Number.isFinite(tempC) && tempC > maxC) maxC = tempC
        } catch { /* skip zone */ }
      }
      if (Number.isFinite(maxC) && maxC > -Infinity) temperatureC = Math.round(maxC * 10) / 10
    } catch { /* no thermal zones */ }

    try {
      const fs = await import('node:fs/promises')
      const cpuinfo = await fs.readFile('/proc/cpuinfo', 'utf-8')
      const mhzMatches = [...cpuinfo.matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)]
      if (mhzMatches.length > 0) {
        const avg = mhzMatches.reduce((a, m) => a + parseFloat(m[1]), 0) / mhzMatches.length
        currentClockMHz = Math.round(avg)
      }
    } catch { /* fallback */ }

    return {
      ...empty,
      physicalCores: null,
      threads: os.cpus().length || null,
      currentClockMHz,
      temperatureC,
    }
  }

  // macOS / others: return empty (CPU temp requires third-party tools like iStats/SMC).
  return empty
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

  // Windows: enumerate fixed logical drives via CIM (df is not on PATH outside Git Bash)
  if (process.platform === 'win32') {
    try {
      const ps = `Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object @{N='mountpoint';E={$_.DeviceID}}, @{N='totalBytes';E={[int64]$_.Size}}, @{N='availableBytes';E={[int64]$_.FreeSpace}} | ConvertTo-Json -Compress`
      const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', ps], { timeoutMs: 5000 })
      if (!stdout.trim()) return disks
      const parsed = JSON.parse(stdout)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      for (const d of arr) {
        const totalBytes = Number(d.totalBytes)
        const availableBytes = Number(d.availableBytes)
        if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue
        const usedBytes = Math.max(0, totalBytes - availableBytes)
        disks.push({
          mountpoint: String(d.mountpoint),
          totalBytes,
          usedBytes,
          availableBytes,
          usagePercent: Math.round((usedBytes / totalBytes) * 100),
        })
      }
      return disks
    } catch (err) {
      logger.error({ err }, 'Error reading disk info (Windows)')
      return disks
    }
  }

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
  utilizationPercent: number | null
  temperatureC: number | null
  powerDrawW: number | null
  fanSpeedPercent: number | null
  clockMHz: number | null
}> | null> {
  // Try NVIDIA first (Linux/macOS/Windows with discrete GPU)
  try {
    const { stdout, code } = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,fan.speed,clocks.current.graphics',
      '--format=csv,noheader,nounits',
    ], { timeoutMs: 3000 })

    if (code === 0 && stdout.trim()) {
      const parseNum = (s: string): number | null => {
        const t = s.trim()
        if (!t || t === '[N/A]' || t === 'N/A' || t === '[Not Supported]') return null
        const n = parseFloat(t)
        return Number.isFinite(n) ? n : null
      }
      const gpus = stdout.trim().split('\n').map(line => {
        const cols = line.split(',').map(s => s.trim())
        const [name, totalStr, usedStr, utilStr, tempStr, powerStr, fanStr, clockStr] = cols
        const memoryTotalMB = parseInt(totalStr, 10)
        const memoryUsedMB = parseInt(usedStr, 10)
        return {
          name,
          memoryTotalMB,
          memoryUsedMB,
          // Keep historical semantic: usagePercent = memory % (UI consumes it as such)
          usagePercent: memoryTotalMB > 0 ? Math.round((memoryUsedMB / memoryTotalMB) * 100) : 0,
          utilizationPercent: parseNum(utilStr),
          temperatureC: parseNum(tempStr),
          powerDrawW: parseNum(powerStr),
          fanSpeedPercent: parseNum(fanStr),
          clockMHz: parseNum(clockStr),
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
            utilizationPercent: null,
            temperatureC: null,
            powerDrawW: null,
            fanSpeedPercent: null,
            clockMHz: null,
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
  // Windows: Get-NetAdapterStatistics (per-adapter cumulative byte counters)
  if (process.platform === 'win32') {
    try {
      const ps = `Get-NetAdapterStatistics | Select-Object @{N='interface';E={$_.Name}}, @{N='rxBytes';E={[int64]$_.ReceivedBytes}}, @{N='txBytes';E={[int64]$_.SentBytes}} | ConvertTo-Json -Compress`
      const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', ps], { timeoutMs: 5000 })
      if (!stdout.trim()) return []
      const parsed = JSON.parse(stdout)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      return arr
        .filter((n: any) => Number.isFinite(n.rxBytes) && Number.isFinite(n.txBytes))
        .map((n: any) => ({ interface: String(n.interface), rxBytes: n.rxBytes, txBytes: n.txBytes }))
    } catch { return [] }
  }

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

  // Windows: Win32_PerfFormattedData_PerfProc_Process gives instantaneous CPU% per process
  if (process.platform === 'win32') {
    try {
      const ps = `$cpus=[Environment]::ProcessorCount; $mem=(Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } | Sort-Object PercentProcessorTime -Descending | Select-Object -First ${MAX_PROCESSES} | ForEach-Object { [PSCustomObject]@{ pid=[int]$_.IDProcess; name=$_.Name; cpuPercent=[math]::Round($_.PercentProcessorTime/$cpus,1); memBytes=[int64]$_.WorkingSetPrivate; memPercent=[math]::Round(($_.WorkingSetPrivate/1024/$mem)*100,1) } } | ConvertTo-Json -Compress`
      const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', ps], { timeoutMs: 5000 })
      if (!stdout.trim()) return []
      const parsed = JSON.parse(stdout)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      return arr.filter((p: any) => Number.isFinite(p.pid)).map((p: any) => ({
        pid: p.pid,
        name: String(p.name || 'unknown'),
        cpuPercent: Number.isFinite(p.cpuPercent) ? p.cpuPercent : 0,
        memPercent: Number.isFinite(p.memPercent) ? p.memPercent : 0,
        memBytes: Number.isFinite(p.memBytes) ? p.memBytes : 0,
      }))
    } catch { return [] }
  }

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
