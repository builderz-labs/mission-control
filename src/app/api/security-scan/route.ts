import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

interface Check {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
}

interface Category {
  score: number
  checks: Check[]
}

const INSECURE_PASSWORDS = new Set([
  'admin', 'password', 'change-me-on-first-login', 'changeme', 'testpass123',
])

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const credentials = scanCredentials()
    const network = scanNetwork()
    const openclaw = scanOpenClaw()
    const runtime = scanRuntime()
    const osLevel = scanOS()

    const categories = { credentials, network, openclaw, runtime, os: osLevel }
    const totalChecks = Object.values(categories).reduce((n, c) => n + c.checks.length, 0)
    const totalPassing = Object.values(categories).reduce((n, c) => n + c.checks.filter(ch => ch.status === 'pass').length, 0)
    const score = totalChecks > 0 ? Math.round((totalPassing / totalChecks) * 100) : 0

    let overall: 'secure' | 'hardened' | 'needs-attention' | 'at-risk'
    if (score >= 90) overall = 'hardened'
    else if (score >= 70) overall = 'secure'
    else if (score >= 40) overall = 'needs-attention'
    else overall = 'at-risk'

    return NextResponse.json({ overall, score, timestamp: Date.now(), categories })
  } catch (error) {
    logger.error({ err: error }, 'Security scan error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function scoreCategory(checks: Check[]): Category {
  const passing = checks.filter(c => c.status === 'pass').length
  return { score: checks.length > 0 ? Math.round((passing / checks.length) * 100) : 100, checks }
}

function scanCredentials(): Category {
  const checks: Check[] = []

  const authPass = process.env.AUTH_PASS || ''
  if (!authPass) {
    checks.push({ id: 'auth_pass_set', name: 'Admin password set', status: 'fail', detail: 'AUTH_PASS is not configured', fix: 'Set AUTH_PASS in .env to a strong password (12+ characters)' })
  } else if (INSECURE_PASSWORDS.has(authPass)) {
    checks.push({ id: 'auth_pass_strong', name: 'Admin password strength', status: 'fail', detail: 'AUTH_PASS is set to a known insecure default', fix: 'Change AUTH_PASS to a unique password with 12+ characters' })
  } else if (authPass.length < 12) {
    checks.push({ id: 'auth_pass_strong', name: 'Admin password strength', status: 'warn', detail: `AUTH_PASS is only ${authPass.length} characters`, fix: 'Use a password with at least 12 characters' })
  } else {
    checks.push({ id: 'auth_pass_strong', name: 'Admin password strength', status: 'pass', detail: 'AUTH_PASS is a strong, non-default password', fix: '' })
  }

  const apiKey = process.env.API_KEY || ''
  checks.push({
    id: 'api_key_set',
    name: 'API key configured',
    status: apiKey && apiKey !== 'generate-a-random-key' ? 'pass' : 'fail',
    detail: !apiKey ? 'API_KEY is not set' : apiKey === 'generate-a-random-key' ? 'API_KEY uses the default placeholder' : 'API_KEY is configured',
    fix: !apiKey || apiKey === 'generate-a-random-key' ? 'Run: bash scripts/generate-env.sh --force' : '',
  })

  const envPath = path.join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    try {
      const stat = statSync(envPath)
      const mode = (stat.mode & 0o777).toString(8)
      checks.push({
        id: 'env_permissions',
        name: '.env file permissions',
        status: mode === '600' ? 'pass' : 'warn',
        detail: `.env permissions are ${mode}`,
        fix: mode !== '600' ? 'Run: chmod 600 .env' : '',
      })
    } catch {
      checks.push({ id: 'env_permissions', name: '.env file permissions', status: 'warn', detail: 'Could not check .env permissions', fix: 'Run: chmod 600 .env' })
    }
  }

  return scoreCategory(checks)
}

function scanNetwork(): Category {
  const checks: Check[] = []

  const allowedHosts = (process.env.MC_ALLOWED_HOSTS || '').trim()
  const allowAny = process.env.MC_ALLOW_ANY_HOST
  checks.push({
    id: 'allowed_hosts',
    name: 'Host allowlist configured',
    status: allowAny === '1' || allowAny === 'true' ? 'fail' : allowedHosts ? 'pass' : 'warn',
    detail: allowAny === '1' || allowAny === 'true' ? 'MC_ALLOW_ANY_HOST is enabled — any host can connect' : allowedHosts ? `MC_ALLOWED_HOSTS: ${allowedHosts}` : 'MC_ALLOWED_HOSTS is not set',
    fix: allowAny ? 'Remove MC_ALLOW_ANY_HOST and set MC_ALLOWED_HOSTS instead' : !allowedHosts ? 'Set MC_ALLOWED_HOSTS=localhost,127.0.0.1 in .env' : '',
  })

  const hsts = process.env.MC_ENABLE_HSTS
  checks.push({
    id: 'hsts_enabled',
    name: 'HSTS enabled',
    status: hsts === '1' ? 'pass' : 'warn',
    detail: hsts === '1' ? 'Strict-Transport-Security header enabled' : 'HSTS is not enabled',
    fix: hsts !== '1' ? 'Set MC_ENABLE_HSTS=1 in .env (requires HTTPS)' : '',
  })

  const cookieSecure = process.env.MC_COOKIE_SECURE
  checks.push({
    id: 'cookie_secure',
    name: 'Secure cookies',
    status: cookieSecure === '1' || cookieSecure === 'true' ? 'pass' : 'warn',
    detail: cookieSecure === '1' || cookieSecure === 'true' ? 'Cookies marked secure' : 'Cookies not explicitly set to secure',
    fix: !(cookieSecure === '1' || cookieSecure === 'true') ? 'Set MC_COOKIE_SECURE=1 in .env (requires HTTPS)' : '',
  })

  const gwHost = config.gatewayHost
  checks.push({
    id: 'gateway_local',
    name: 'Gateway bound to localhost',
    status: gwHost === '127.0.0.1' || gwHost === 'localhost' ? 'pass' : 'fail',
    detail: `Gateway host is ${gwHost}`,
    fix: gwHost !== '127.0.0.1' && gwHost !== 'localhost' ? 'Set OPENCLAW_GATEWAY_HOST=127.0.0.1 — never expose the gateway publicly' : '',
  })

  return scoreCategory(checks)
}

function scanOpenClaw(): Category {
  const checks: Check[] = []
  const configPath = config.openclawConfigPath

  if (!configPath || !existsSync(configPath)) {
    checks.push({
      id: 'config_found',
      name: 'OpenClaw config found',
      status: 'warn',
      detail: 'openclaw.json not found — OpenClaw checks skipped',
      fix: 'Set OPENCLAW_HOME or OPENCLAW_CONFIG_PATH in .env',
    })
    return scoreCategory(checks)
  }

  let ocConfig: any
  try {
    ocConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (err) {
    checks.push({
      id: 'config_valid',
      name: 'OpenClaw config valid',
      status: 'fail',
      detail: 'openclaw.json could not be parsed',
      fix: 'Check openclaw.json for syntax errors',
    })
    return scoreCategory(checks)
  }

  // Config file permissions
  try {
    const stat = statSync(configPath)
    const mode = (stat.mode & 0o777).toString(8)
    checks.push({
      id: 'config_permissions',
      name: 'Config file permissions',
      status: mode === '600' ? 'pass' : 'warn',
      detail: `openclaw.json permissions are ${mode}`,
      fix: mode !== '600' ? `Run: chmod 600 ${configPath}` : '',
    })
  } catch { /* skip */ }

  // Gateway auth
  const gwAuth = ocConfig?.gateway?.auth
  checks.push({
    id: 'gateway_auth',
    name: 'Gateway authentication',
    status: gwAuth?.mode === 'token' && gwAuth?.token ? 'pass' : 'fail',
    detail: gwAuth?.mode === 'token' ? 'Token auth enabled' : `Auth mode: ${gwAuth?.mode || 'none'}`,
    fix: gwAuth?.mode !== 'token' ? 'Set gateway.auth.mode to "token" with a strong random token' : '',
  })

  // Gateway bind
  const gwBind = ocConfig?.gateway?.bind
  checks.push({
    id: 'gateway_bind',
    name: 'Gateway bind address',
    status: gwBind === 'loopback' || gwBind === '127.0.0.1' ? 'pass' : 'fail',
    detail: `Gateway bind: ${gwBind || 'not set'}`,
    fix: gwBind !== 'loopback' ? 'Set gateway.bind to "loopback" to prevent external access' : '',
  })

  // Tools profile
  const toolsProfile = ocConfig?.tools?.profile
  checks.push({
    id: 'tools_restricted',
    name: 'Tool permissions restricted',
    status: toolsProfile && toolsProfile !== 'all' ? 'pass' : 'warn',
    detail: `Tools profile: ${toolsProfile || 'default'}`,
    fix: toolsProfile === 'all' ? 'Use a restrictive tools profile like "messaging" or "coding"' : '',
  })

  // Elevated mode
  const elevated = ocConfig?.elevated?.enabled
  checks.push({
    id: 'elevated_disabled',
    name: 'Elevated mode disabled',
    status: elevated !== true ? 'pass' : 'fail',
    detail: elevated === true ? 'Elevated mode is enabled' : 'Elevated mode is disabled',
    fix: elevated === true ? 'Set elevated.enabled to false unless explicitly needed' : '',
  })

  // DM isolation
  const dmScope = ocConfig?.session?.dmScope
  checks.push({
    id: 'dm_isolation',
    name: 'DM session isolation',
    status: dmScope === 'per-channel-peer' ? 'pass' : 'warn',
    detail: `DM scope: ${dmScope || 'default'}`,
    fix: dmScope !== 'per-channel-peer' ? 'Set session.dmScope to "per-channel-peer" to prevent context leakage' : '',
  })

  // Exec security
  const execSecurity = ocConfig?.tools?.exec?.security
  checks.push({
    id: 'exec_restricted',
    name: 'Exec tool restricted',
    status: execSecurity === 'deny' ? 'pass' : execSecurity === 'sandbox' ? 'pass' : 'warn',
    detail: `Exec security: ${execSecurity || 'default'}`,
    fix: execSecurity !== 'deny' && execSecurity !== 'sandbox' ? 'Set tools.exec.security to "deny" or "sandbox"' : '',
  })

  return scoreCategory(checks)
}

function scanRuntime(): Category {
  const checks: Check[] = []

  // Injection guard
  try {
    require('@/lib/injection-guard')
    checks.push({
      id: 'injection_guard',
      name: 'Injection guard active',
      status: 'pass',
      detail: 'Prompt and command injection protection is loaded',
      fix: '',
    })
  } catch {
    checks.push({
      id: 'injection_guard',
      name: 'Injection guard active',
      status: 'fail',
      detail: 'Injection guard module not found',
      fix: 'Ensure src/lib/injection-guard.ts exists and is importable',
    })
  }

  // Rate limiting
  const rlDisabled = process.env.MC_DISABLE_RATE_LIMIT
  checks.push({
    id: 'rate_limiting',
    name: 'Rate limiting active',
    status: !rlDisabled ? 'pass' : 'fail',
    detail: rlDisabled ? 'Rate limiting is disabled' : 'Rate limiting is active',
    fix: rlDisabled ? 'Remove MC_DISABLE_RATE_LIMIT from .env' : '',
  })

  // Docker detection
  const isDocker = existsSync('/.dockerenv')
  if (isDocker) {
    checks.push({
      id: 'docker_detected',
      name: 'Running in Docker',
      status: 'pass',
      detail: 'Container environment detected',
      fix: '',
    })
  }

  // Recent backup
  try {
    const backupDir = path.join(path.dirname(config.dbPath), 'backups')
    if (existsSync(backupDir)) {
      const files = readdirSync(backupDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => {
          const stat = statSync(path.join(backupDir, f))
          return { mtime: stat.mtimeMs }
        })
        .sort((a: any, b: any) => b.mtime - a.mtime)

      if (files.length > 0) {
        const ageHours = Math.round((Date.now() - files[0].mtime) / 3600000)
        checks.push({
          id: 'backup_recent',
          name: 'Recent backup exists',
          status: ageHours < 24 ? 'pass' : ageHours < 168 ? 'warn' : 'fail',
          detail: `Latest backup is ${ageHours}h old`,
          fix: ageHours >= 24 ? 'Enable auto_backup in Settings or run: curl -X POST /api/backup' : '',
        })
      } else {
        checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backups found', fix: 'Enable auto_backup in Settings' })
      }
    } else {
      checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'No backup directory', fix: 'Enable auto_backup in Settings' })
    }
  } catch {
    checks.push({ id: 'backup_recent', name: 'Recent backup exists', status: 'warn', detail: 'Could not check backups', fix: '' })
  }

  // DB integrity
  try {
    const db = getDatabase()
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined
    checks.push({
      id: 'db_integrity',
      name: 'Database integrity',
      status: result?.integrity_check === 'ok' ? 'pass' : 'fail',
      detail: result?.integrity_check === 'ok' ? 'Integrity check passed' : `Integrity: ${result?.integrity_check || 'unknown'}`,
      fix: result?.integrity_check !== 'ok' ? 'Database may be corrupted — restore from backup' : '',
    })
  } catch {
    checks.push({ id: 'db_integrity', name: 'Database integrity', status: 'warn', detail: 'Could not run integrity check', fix: '' })
  }

  return scoreCategory(checks)
}

/** Run a shell command safely, returning stdout or null on failure.
 *  Only called with hardcoded string literals — no user input is ever passed. */
function tryExec(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function scanOS(): Category {
  const checks: Check[] = []
  const platform = os.platform()
  const isLinux = platform === 'linux'
  const isDarwin = platform === 'darwin'

  // 1. Running as root check
  const uid = process.getuid?.()
  if (uid !== undefined) {
    checks.push({
      id: 'not_root',
      name: 'Not running as root',
      status: uid === 0 ? 'fail' : 'pass',
      detail: uid === 0 ? 'Process is running as root (UID 0)' : `Running as UID ${uid}`,
      fix: uid === 0 ? 'Run Mission Control as a non-root user' : '',
    })
  }

  // 2. Firewall status
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
    })
  }

  // 3. Open listening ports
  if (isLinux || isDarwin) {
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
    })
  }

  // 4. SSH hardening (Linux)
  if (isLinux && existsSync('/etc/ssh/sshd_config')) {
    const sshdConfig = tryExec('grep -i "^PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null')
    if (sshdConfig !== null) {
      const allowsRoot = sshdConfig.toLowerCase().includes('yes')
      checks.push({
        id: 'ssh_root',
        name: 'SSH root login disabled',
        status: allowsRoot ? 'fail' : 'pass',
        detail: allowsRoot ? 'SSH allows root login' : 'SSH root login is restricted',
        fix: allowsRoot ? 'Set PermitRootLogin no in /etc/ssh/sshd_config and restart sshd' : '',
      })
    }

    const sshPwAuth = tryExec('grep -i "^PasswordAuthentication" /etc/ssh/sshd_config 2>/dev/null')
    if (sshPwAuth !== null) {
      const allowsPw = sshPwAuth.toLowerCase().includes('yes')
      checks.push({
        id: 'ssh_password',
        name: 'SSH password auth disabled',
        status: allowsPw ? 'warn' : 'pass',
        detail: allowsPw ? 'SSH allows password authentication' : 'SSH uses key-based authentication only',
        fix: allowsPw ? 'Set PasswordAuthentication no in /etc/ssh/sshd_config' : '',
      })
    }
  }

  // 5. Automatic updates
  if (isLinux) {
    const hasUnattended = existsSync('/etc/apt/apt.conf.d/20auto-upgrades')
      || existsSync('/etc/yum/yum-cron.conf')
      || existsSync('/etc/dnf/automatic.conf')
    checks.push({
      id: 'auto_updates',
      name: 'Automatic security updates',
      status: hasUnattended ? 'pass' : 'warn',
      detail: hasUnattended ? 'Automatic update configuration found' : 'No automatic update configuration detected',
      fix: !hasUnattended ? 'Install unattended-upgrades (Debian/Ubuntu) or dnf-automatic (RHEL/Fedora)' : '',
    })
  } else if (isDarwin) {
    const autoUpdate = tryExec('defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled 2>/dev/null')
    checks.push({
      id: 'auto_updates',
      name: 'Automatic software updates',
      status: autoUpdate === '1' ? 'pass' : 'warn',
      detail: autoUpdate === '1' ? 'Automatic update checks enabled' : 'Automatic update status unknown',
      fix: autoUpdate !== '1' ? 'Enable in System Settings > General > Software Update' : '',
    })
  }

  // 6. Disk encryption
  if (isDarwin) {
    const fvStatus = tryExec('fdesetup status 2>/dev/null')
    const encrypted = fvStatus?.includes('On')
    checks.push({
      id: 'disk_encryption',
      name: 'Disk encryption (FileVault)',
      status: encrypted ? 'pass' : 'fail',
      detail: encrypted ? 'FileVault is enabled' : 'FileVault is not enabled',
      fix: !encrypted ? 'Enable FileVault in System Settings > Privacy & Security' : '',
    })
  } else if (isLinux) {
    const luksDevices = tryExec('lsblk -o TYPE 2>/dev/null | grep -c crypt')
    const hasCrypt = luksDevices ? parseInt(luksDevices, 10) > 0 : false
    checks.push({
      id: 'disk_encryption',
      name: 'Disk encryption (LUKS)',
      status: hasCrypt ? 'pass' : 'warn',
      detail: hasCrypt ? 'Encrypted volumes detected' : 'No LUKS-encrypted volumes detected',
      fix: !hasCrypt ? 'Consider encrypting data volumes with LUKS' : '',
    })
  }

  // 7. System uptime (long uptimes may indicate missing kernel patches)
  const uptimeSeconds = os.uptime()
  const uptimeDays = Math.floor(uptimeSeconds / 86400)
  checks.push({
    id: 'uptime',
    name: 'System reboot freshness',
    status: uptimeDays < 30 ? 'pass' : uptimeDays < 90 ? 'warn' : 'fail',
    detail: `System uptime: ${uptimeDays} day${uptimeDays !== 1 ? 's' : ''}`,
    fix: uptimeDays >= 30 ? 'Consider rebooting to apply kernel and system updates' : '',
  })

  // 8. World-writable files in the app directory
  if (isLinux || isDarwin) {
    const cwd = process.cwd()
    const wwFiles = tryExec(`find "${cwd}" -maxdepth 2 -perm -o+w -not -type l 2>/dev/null | head -5`)
    const wwCount = wwFiles ? wwFiles.split('\n').filter(Boolean).length : 0
    checks.push({
      id: 'world_writable',
      name: 'No world-writable app files',
      status: wwCount === 0 ? 'pass' : 'warn',
      detail: wwCount === 0 ? 'No world-writable files in app directory' : `${wwCount}+ world-writable file${wwCount > 1 ? 's' : ''} found`,
      fix: wwCount > 0 ? 'Run: chmod o-w on affected files' : '',
    })
  }

  // 9. Node.js version (EOL check)
  const nodeVersion = process.versions.node
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10)
  checks.push({
    id: 'node_supported',
    name: 'Node.js version supported',
    status: nodeMajor >= 20 ? 'pass' : nodeMajor >= 18 ? 'warn' : 'fail',
    detail: `Node.js v${nodeVersion}`,
    fix: nodeMajor < 20 ? 'Upgrade to Node.js 20 LTS or later' : '',
  })

  return scoreCategory(checks)
}
