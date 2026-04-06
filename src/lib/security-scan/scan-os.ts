// ---------------------------------------------------------------------------
// OS scanner — orchestrates cross-platform + platform-specific hardening
// ---------------------------------------------------------------------------

import os from 'node:os'
import { type Category, type Check } from './types'
import { scoreCategory } from './report'
import { cachedExec, tryExec } from './exec-helpers'
import { addLinuxHardeningChecks } from './scan-os-linux'
import { addDarwinHardeningChecks } from './scan-os-darwin'
import { addWindowsHardeningChecks } from './scan-os-windows'

export function scanOS(): Category {
  const checks: Check[] = []
  const platform = os.platform()
  const isLinux = platform === 'linux'
  const isDarwin = platform === 'darwin'
  const isWindows = platform === 'win32'

  addCrossPlatformChecks(checks, isLinux)
  addFirewallCheck(checks, isLinux, isDarwin)
  addOpenPortsCheck(checks, isLinux, isDarwin)
  addWorldWritableCheck(checks, isLinux, isDarwin)

  if (isLinux) addLinuxHardeningChecks(checks)
  if (isDarwin) addDarwinHardeningChecks(checks)
  if (isWindows) addWindowsHardeningChecks(checks)

  return scoreCategory(checks)
}

function addCrossPlatformChecks(checks: Check[], isLinux: boolean): void {
  const uid = process.getuid?.()
  if (uid !== undefined) {
    checks.push({
      id: 'not_root',
      name: 'Not running as root',
      status: uid === 0 ? 'fail' : 'pass',
      detail: uid === 0 ? 'Process is running as root (UID 0)' : `Running as UID ${uid}`,
      fix: uid === 0 ? 'Run Ultron Mission Control as a non-root user' : '',
      severity: 'critical',
      platform: 'all',
    })
  }

  const nodeVersion = process.versions.node
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10)
  checks.push({
    id: 'node_supported',
    name: 'Node.js version supported',
    status: nodeMajor >= 20 ? 'pass' : nodeMajor >= 18 ? 'warn' : 'fail',
    detail: `Node.js v${nodeVersion}`,
    fix: nodeMajor < 20 ? 'Upgrade to Node.js 20 LTS or later' : '',
    severity: 'medium',
    platform: 'all',
  })

  // Elevated capabilities — Linux only, not applicable when already root
  if (isLinux && uid !== undefined && uid !== 0) {
    const caps = cachedExec('node_caps', 'getcap $(which node) 2>/dev/null')
    const hasCaps = caps ? caps.includes('=') : false
    checks.push({
      id: 'node_permissions',
      name: 'Node.js no elevated capabilities',
      status: hasCaps ? 'warn' : 'pass',
      detail: hasCaps ? `Node binary has capabilities: ${caps}` : 'Node binary has no special capabilities',
      fix: hasCaps ? 'Remove capabilities: sudo setcap -r $(which node)' : '',
      severity: 'medium',
      platform: 'linux',
    })
  }

  addUptimeCheck(checks)

  // Linux NTP — Darwin NTP is included inside addDarwinHardeningChecks
  if (isLinux) addLinuxNtpCheck(checks)
}

function addUptimeCheck(checks: Check[]): void {
  let uptimeSeconds: number | null = null
  try {
    const value = os.uptime()
    uptimeSeconds = Number.isFinite(value) && value >= 0 ? value : null
  } catch { /* uptime unavailable in some environments */ }

  if (uptimeSeconds === null) {
    checks.push({
      id: 'uptime',
      name: 'System reboot freshness',
      status: 'warn',
      detail: 'System uptime is unavailable in this runtime environment',
      fix: '',
      severity: 'low',
      platform: 'all',
    })
    return
  }

  const uptimeDays = Math.floor(uptimeSeconds / 86400)
  checks.push({
    id: 'uptime',
    name: 'System reboot freshness',
    status: uptimeDays < 30 ? 'pass' : uptimeDays < 90 ? 'warn' : 'fail',
    detail: `System uptime: ${uptimeDays} day${uptimeDays !== 1 ? 's' : ''}`,
    fix: uptimeDays >= 30 ? 'Consider rebooting to apply kernel and system updates' : '',
    severity: 'low',
    platform: 'all',
  })
}

function addLinuxNtpCheck(checks: Check[]): void {
  const ntpStatus = cachedExec(
    'ntp_sync',
    'timedatectl status 2>/dev/null | grep -i "synchronized\\|ntp" | head -2',
  )
  const ntpActive =
    ntpStatus?.toLowerCase().includes('yes') || ntpStatus?.toLowerCase().includes('active')
  checks.push({
    id: 'ntp_sync',
    name: 'Time synchronization',
    status: ntpActive ? 'pass' : 'warn',
    detail: ntpActive ? 'NTP synchronization is active' : 'NTP sync status unknown or inactive',
    fix: !ntpActive ? 'Enable NTP: sudo timedatectl set-ntp true' : '',
    severity: 'low',
    platform: 'linux',
  })
}

function addFirewallCheck(checks: Check[], isLinux: boolean, isDarwin: boolean): void {
  if (isLinux) {
    const ufwStatus = tryExec('ufw status 2>/dev/null')
    const iptablesCount = tryExec('iptables -L -n 2>/dev/null | wc -l')
    const nftCount = tryExec('nft list ruleset 2>/dev/null | wc -l')
    const hasUfw = ufwStatus?.includes('active')
    const hasIptables = iptablesCount ? parseInt(iptablesCount, 10) > 8 : false
    const hasNft = nftCount ? parseInt(nftCount, 10) > 0 : false
    checks.push({
      id: 'firewall',
      name: 'Firewall active',
      status: hasUfw || hasIptables || hasNft ? 'pass' : 'warn',
      detail: hasUfw ? 'UFW firewall is active' : hasIptables ? 'iptables rules present' : hasNft ? 'nftables rules present' : 'No firewall detected',
      fix: !hasUfw && !hasIptables && !hasNft ? 'Enable a firewall: sudo ufw enable' : '',
      severity: 'critical',
      platform: 'linux',
    })
  } else if (isDarwin) {
    const pfStatus = tryExec('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null')
    const fwEnabled = pfStatus?.includes('enabled')
    checks.push({
      id: 'firewall',
      name: 'Firewall active',
      status: fwEnabled ? 'pass' : 'warn',
      detail: fwEnabled ? 'macOS application firewall is enabled' : 'macOS firewall is disabled',
      fix: !fwEnabled ? 'Enable firewall: System Settings > Network > Firewall' : '',
      severity: 'critical',
      platform: 'darwin',
    })
  }
}

function addOpenPortsCheck(checks: Check[], isLinux: boolean, isDarwin: boolean): void {
  if (!isLinux && !isDarwin) return
  const portCmd = isLinux
    ? 'ss -tlnp 2>/dev/null | tail -n +2 | wc -l'
    : 'netstat -an 2>/dev/null | grep LISTEN | wc -l'
  const portCount = tryExec(portCmd)
  const count = portCount ? parseInt(portCount.trim(), 10) : 0
  checks.push({
    id: 'open_ports',
    name: 'Listening ports',
    status: count <= 10 ? 'pass' : count <= 25 ? 'warn' : 'fail',
    detail: `${count} listening port${count !== 1 ? 's' : ''} detected`,
    fix: count > 10 ? 'Review open ports and close unnecessary services' : '',
    severity: 'medium',
    platform: isLinux ? 'linux' : 'darwin',
  })
}

function addWorldWritableCheck(checks: Check[], isLinux: boolean, isDarwin: boolean): void {
  if (!isLinux && !isDarwin) return
  const cwd = process.cwd()
  const wwFiles = tryExec(`find "${cwd}" -maxdepth 2 -perm -o+w -not -type l 2>/dev/null | head -5`)
  const wwCount = wwFiles ? wwFiles.split('\n').filter(Boolean).length : 0
  checks.push({
    id: 'world_writable',
    name: 'No world-writable app files',
    status: wwCount === 0 ? 'pass' : 'warn',
    detail: wwCount === 0
      ? 'No world-writable files in app directory'
      : `${wwCount}+ world-writable file${wwCount > 1 ? 's' : ''} found`,
    fix: wwCount > 0 ? 'Run: chmod o-w on affected files' : '',
    severity: 'medium',
    fixSafety: 'safe',
    platform: isLinux ? 'linux' : 'darwin',
  })
}
