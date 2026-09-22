type CheckStatus = 'pass' | 'fail' | 'warn'

export interface DarwinCheck {
  id: string
  name: string
  status: CheckStatus
  detail: string
  fix: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  platform: 'darwin'
  fixSafety?: 'safe' | 'requires-restart' | 'requires-review' | 'manual-only'
}

export type ExecFn = (cmd: string) => string | null

const LOOPBACK = new Set(['127.0.0.1', '::1'])

function socketfilterOn(text: string | null): boolean {
  if (!text) return false
  const value = text.toLowerCase()
  if (value.includes('off') || value.includes('disabled')) return false
  return value.includes('on') || value.includes('enabled')
}

/** Unique non-loopback TCP listen ports from `netstat -an` output. */
export function publicListenPorts(netstatOutput: string): number[] {
  const ports = new Set<number>()
  for (const line of netstatOutput.split('\n')) {
    if (!/\bLISTEN\b/.test(line)) continue
    const parts = line.trim().split(/\s+/)
    const local = parts[3]
    if (!local) continue
    const split = local.lastIndexOf('.')
    if (split <= 0) continue
    const host = local.slice(0, split)
    const port = Number(local.slice(split + 1))
    if (!Number.isFinite(port)) continue
    if (LOOPBACK.has(host)) continue
    ports.add(port)
  }
  return [...ports].sort((a, b) => a - b)
}

export function darwinNtpCheck(exec: ExecFn): DarwinCheck {
  const sntp = exec('sntp time.apple.com 2>/dev/null | head -1')
  const synced = Boolean(sntp && /[+-][0-9]+\.[0-9]+/.test(sntp))
  const setup = exec('systemsetup -getusingnetworktime 2>/dev/null')
  const setupOn = Boolean(setup?.toLowerCase().includes('on'))
  const ok = synced || setupOn
  return {
    id: 'ntp_sync',
    name: 'Time synchronization',
    status: ok ? 'pass' : 'warn',
    detail: ok ? 'Clock is synchronized with network time' : 'Network time may be disabled',
    fix: ok ? '' : 'Enable: sudo systemsetup -setusingnetworktime on',
    severity: 'low',
    platform: 'darwin',
  }
}

export function darwinFirewallCheck(exec: ExecFn): DarwinCheck {
  const status = exec('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null')
  const enabled = socketfilterOn(status)
  return {
    id: 'firewall',
    name: 'Firewall active',
    status: enabled ? 'pass' : 'warn',
    detail: enabled ? 'macOS application firewall is enabled' : 'macOS firewall is disabled',
    fix: enabled ? '' : 'Enable firewall: System Settings > Network > Firewall',
    severity: 'critical',
    platform: 'darwin',
  }
}

export function darwinListenPortsCheck(exec: ExecFn): DarwinCheck {
  const raw = exec('netstat -an 2>/dev/null | grep LISTEN') || ''
  const ports = publicListenPorts(raw)
  const count = ports.length
  return {
    id: 'open_ports',
    name: 'Listening ports',
    status: count <= 10 ? 'pass' : count <= 25 ? 'warn' : 'fail',
    detail: count === 0
      ? 'No non-loopback listening ports'
      : `${count} public listening port${count === 1 ? '' : 's'}: ${ports.join(', ')}`,
    fix: count > 10 ? 'Review public listen ports and close unnecessary sharing services' : '',
    severity: 'medium',
    platform: 'darwin',
  }
}

export function darwinAutoUpdatesCheck(exec: ExecFn): DarwinCheck {
  const domain = '/Library/Preferences/com.apple.SoftwareUpdate'
  const keys = [
    'AutomaticCheckEnabled',
    'AutomaticDownload',
    'AutomaticallyInstallMacOSUpdates',
    'CriticalUpdateInstall',
    'ConfigDataInstall',
  ]
  const enabled = keys.some((key) => exec(`defaults read ${domain} ${key} 2>/dev/null`) === '1')
  const schedule = exec('softwareupdate --schedule 2>/dev/null')
  const scheduleOn = Boolean(schedule?.toLowerCase().includes('on'))
  const ok = enabled || scheduleOn
  return {
    id: 'auto_updates',
    name: 'Automatic software updates',
    status: ok ? 'pass' : 'warn',
    detail: ok ? 'Automatic update checks enabled' : 'Automatic update status unknown',
    fix: ok ? '' : 'Enable in System Settings > General > Software Update',
    severity: 'medium',
    platform: 'darwin',
  }
}

export function darwinStealthCheck(exec: ExecFn): DarwinCheck {
  const status = exec('/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null')
  const enabled = socketfilterOn(status)
  return {
    id: 'macos_stealth_mode',
    name: 'Firewall stealth mode',
    status: enabled ? 'pass' : 'warn',
    detail: enabled ? 'Stealth mode is enabled' : 'Stealth mode is disabled',
    fix: enabled ? '' : 'Enable: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'darwin',
  }
}

export function darwinRemoteLoginCheck(exec: ExecFn): DarwinCheck {
  const launchd = exec('launchctl print system/com.openssh.sshd 2>/dev/null')
  const notRunning = Boolean(launchd?.includes('state = not running') || launchd?.includes('state = disabled'))
  const netstat = exec('netstat -an 2>/dev/null | grep LISTEN') || ''
  const sshPort = publicListenPorts(netstat).includes(22)
  const setup = exec('systemsetup -getremotelogin 2>/dev/null')
  const setupOff = Boolean(setup?.toLowerCase().includes('off'))
  const off = setupOff || (notRunning && !sshPort)
  return {
    id: 'macos_remote_login',
    name: 'Remote login disabled',
    status: off ? 'pass' : 'warn',
    detail: off ? 'Remote login (SSH) is disabled' : 'Remote login (SSH) is enabled',
    fix: off ? '' : 'Disable if not needed: sudo systemsetup -setremotelogin off',
    severity: 'medium',
    fixSafety: 'manual-only',
    platform: 'darwin',
  }
}
