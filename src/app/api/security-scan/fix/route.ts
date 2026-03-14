import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { FIX_SAFETY, runSecurityScan, type FixSafety } from '@/lib/security-scan'

export interface FixResult {
  id: string
  name: string
  fixed: boolean
  detail: string
  fixSafety?: FixSafety
}

function shouldMutateRuntimeEnv() {
  return process.env.MISSION_CONTROL_TEST_MODE !== '1'
}

function normalizeHostname(raw: string): string {
  return raw.trim().replace(/^\[|\]$/g, '').split(':')[0].replace(/\.$/, '').toLowerCase()
}

function parseForwardedHost(forwarded: string | null): string[] {
  if (!forwarded) return []
  const hosts: string[] = []
  for (const part of forwarded.split(',')) {
    const match = /(?:^|;)\s*host="?([^";]+)"?/i.exec(part)
    if (match?.[1]) hosts.push(match[1])
  }
  return hosts
}

function getRequestHostCandidates(request: NextRequest): string[] {
  const rawCandidates = [
    ...(request.headers.get('x-forwarded-host') || '').split(','),
    ...(request.headers.get('x-original-host') || '').split(','),
    ...(request.headers.get('x-forwarded-server') || '').split(','),
    ...parseForwardedHost(request.headers.get('forwarded')),
    request.headers.get('host') || '',
    request.nextUrl.host || '',
    request.nextUrl.hostname || '',
  ]

  return [...new Set(rawCandidates.map(normalizeHostname).filter(Boolean))]
}

function getFailingChecks() {
  return Object.values(runSecurityScan().categories)
    .flatMap((category) => category.checks)
    .filter((check) => check.status !== 'pass')
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Optional: pass { ids: ["check_id"] } to fix only specific issues
  let targetIds: Set<string> | null = null
  try {
    const body = await request.json()
    if (Array.isArray(body?.ids) && body.ids.length > 0) {
      targetIds = new Set(body.ids as string[])
    }
  } catch { /* no body = fix all */ }

  const shouldFix = (id: string) => !targetIds || targetIds.has(id)

  const results: FixResult[] = []
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
  ]

  function readEnv(filePath: string): string {
    try { return readFileSync(filePath, 'utf-8') } catch { return '' }
  }

  function setEnvVar(key: string, value: string) {
    let targetPath = envPaths[0]
    for (const filePath of envPaths) {
      const content = readEnv(filePath)
      if (new RegExp(`^${key}=.*$`, 'm').test(content)) {
        targetPath = filePath
        break
      }
    }

    let content = readEnv(targetPath)
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`)
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`
    }
    writeFileSync(targetPath, content, 'utf-8')
    if (shouldMutateRuntimeEnv()) {
      process.env[key] = value
    }
  }

  function unsetEnvVar(key: string) {
    const regex = new RegExp(`^${key}=.*\n?`, 'm')
    for (const filePath of envPaths) {
      let content = readEnv(filePath)
      if (regex.test(content)) {
        content = content.replace(regex, '')
        writeFileSync(filePath, content, 'utf-8')
      }
    }
    if (shouldMutateRuntimeEnv()) {
      delete process.env[key]
    }
  }

  // 1. Fix .env file permissions
  const envPath = envPaths[0]
  if (shouldFix('env_permissions') && existsSync(envPath)) {
    try {
      const stat = statSync(envPath)
      const mode = (stat.mode & 0o777).toString(8)
      if (mode !== '600') {
        chmodSync(envPath, 0o600)
        results.push({ id: 'env_permissions', name: '.env file permissions', fixed: true, detail: `Changed from ${mode} to 600`, fixSafety: FIX_SAFETY['env_permissions'] })
      } else {
        results.push({ id: 'env_permissions', name: '.env file permissions', fixed: true, detail: 'Already 600', fixSafety: FIX_SAFETY['env_permissions'] })
      }
    } catch (e: any) {
      results.push({ id: 'env_permissions', name: '.env file permissions', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['env_permissions'] })
    }
  }

  // 2. Fix MC_ALLOWED_HOSTS if not set
  const allowedHosts = (process.env.MC_ALLOWED_HOSTS || '').trim()
  const allowAny = process.env.MC_ALLOW_ANY_HOST
  if (shouldFix('allowed_hosts') && (!allowedHosts || allowAny === '1' || allowAny === 'true')) {
    try {
      if (allowAny) {
        unsetEnvVar('MC_ALLOW_ANY_HOST')
      }
      const preservedHosts = new Set([
        'localhost',
        '127.0.0.1',
        ...allowedHosts.split(',').map((host) => normalizeHostname(host)).filter(Boolean),
        ...getRequestHostCandidates(request),
      ])
      const mergedHosts = Array.from(preservedHosts)
      setEnvVar('MC_ALLOWED_HOSTS', mergedHosts.join(','))
      results.push({ id: 'allowed_hosts', name: 'Host allowlist', fixed: true, detail: `Set MC_ALLOWED_HOSTS=${mergedHosts.join(',')}`, fixSafety: FIX_SAFETY['allowed_hosts'] })
    } catch (e: any) {
      results.push({ id: 'allowed_hosts', name: 'Host allowlist', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['allowed_hosts'] })
    }
  }

  // 3. Fix MC_ENABLE_HSTS
  if (shouldFix('hsts_enabled') && process.env.MC_ENABLE_HSTS !== '1') {
    try {
      setEnvVar('MC_ENABLE_HSTS', '1')
      results.push({ id: 'hsts_enabled', name: 'HSTS enabled', fixed: true, detail: 'Set MC_ENABLE_HSTS=1', fixSafety: FIX_SAFETY['hsts_enabled'] })
    } catch (e: any) {
      results.push({ id: 'hsts_enabled', name: 'HSTS', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['hsts_enabled'] })
    }
  }

  // 4. Fix MC_COOKIE_SECURE
  const cookieSecure = process.env.MC_COOKIE_SECURE
  if (shouldFix('cookie_secure') && cookieSecure !== '1' && cookieSecure !== 'true') {
    try {
      setEnvVar('MC_COOKIE_SECURE', '1')
      results.push({ id: 'cookie_secure', name: 'Secure cookies', fixed: true, detail: 'Set MC_COOKIE_SECURE=1', fixSafety: FIX_SAFETY['cookie_secure'] })
    } catch (e: any) {
      results.push({ id: 'cookie_secure', name: 'Secure cookies', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['cookie_secure'] })
    }
  }

  // 4b. Re-enable runtime rate limiting
  const rateLimitDisabled = process.env.MC_DISABLE_RATE_LIMIT
  if (shouldFix('rate_limiting') && rateLimitDisabled) {
    try {
      unsetEnvVar('MC_DISABLE_RATE_LIMIT')
      results.push({ id: 'rate_limiting', name: 'Rate limiting active', fixed: true, detail: 'Removed MC_DISABLE_RATE_LIMIT', fixSafety: FIX_SAFETY['rate_limiting'] })
    } catch (e: any) {
      results.push({ id: 'rate_limiting', name: 'Rate limiting active', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['rate_limiting'] })
    }
  }

  // 5. Fix API_KEY if it's a known default
  const apiKey = process.env.API_KEY || ''
  if (shouldFix('api_key_set') && (!apiKey || apiKey === 'generate-a-random-key')) {
    try {
      const newKey = crypto.randomBytes(32).toString('hex')
      setEnvVar('API_KEY', newKey)
      results.push({ id: 'api_key_set', name: 'API key', fixed: true, detail: 'Generated new random API key', fixSafety: FIX_SAFETY['api_key_set'] })
    } catch (e: any) {
      results.push({ id: 'api_key_set', name: 'API key', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['api_key_set'] })
    }
  }

  // 6. Fix OpenClaw config
  const ocFixIds = ['config_permissions', 'gateway_auth', 'gateway_bind', 'elevated_disabled', 'dm_isolation', 'exec_restricted', 'control_ui_device_auth', 'control_ui_insecure_auth', 'fs_workspace_only', 'log_redaction']
  const configPath = config.openclawConfigPath
  if (ocFixIds.some(id => shouldFix(id)) && configPath && existsSync(configPath)) {
    let ocConfig: any
    try {
      ocConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch { ocConfig = null }

    if (ocConfig) {
      let configChanged = false

      // Fix config file permissions
      if (shouldFix('config_permissions')) try {
        const stat = statSync(configPath)
        const mode = (stat.mode & 0o777).toString(8)
        if (mode !== '600') {
          chmodSync(configPath, 0o600)
          results.push({ id: 'config_permissions', name: 'OpenClaw config permissions', fixed: true, detail: `Changed from ${mode} to 600`, fixSafety: FIX_SAFETY['config_permissions'] })
        }
      } catch (e: any) {
        results.push({ id: 'config_permissions', name: 'OpenClaw config permissions', fixed: false, detail: e.message, fixSafety: FIX_SAFETY['config_permissions'] })
      }

      // Fix gateway auth
      if (shouldFix('gateway_auth')) {
        if (!ocConfig.gateway) ocConfig.gateway = {}
        if (!ocConfig.gateway.auth) ocConfig.gateway.auth = {}
        if (ocConfig.gateway.auth.mode !== 'token') {
          ocConfig.gateway.auth.mode = 'token'
          if (!ocConfig.gateway.auth.token) {
            ocConfig.gateway.auth.token = crypto.randomBytes(32).toString('hex')
          }
          configChanged = true
          results.push({ id: 'gateway_auth', name: 'Gateway authentication', fixed: true, detail: 'Set auth.mode to "token" with generated token', fixSafety: FIX_SAFETY['gateway_auth'] })
        }
      }

      // Fix gateway bind
      if (shouldFix('gateway_bind')) {
        if (!ocConfig.gateway) ocConfig.gateway = {}
        if (ocConfig.gateway.bind !== 'loopback' && ocConfig.gateway.bind !== '127.0.0.1') {
          ocConfig.gateway.bind = 'loopback'
          configChanged = true
          results.push({ id: 'gateway_bind', name: 'Gateway bind address', fixed: true, detail: 'Set bind to "loopback"', fixSafety: FIX_SAFETY['gateway_bind'] })
        }
      }

      // Fix elevated mode
      if (shouldFix('elevated_disabled')) {
        if (!ocConfig.elevated) ocConfig.elevated = {}
        if (ocConfig.elevated.enabled === true) {
          ocConfig.elevated.enabled = false
          configChanged = true
          results.push({ id: 'elevated_disabled', name: 'Elevated mode', fixed: true, detail: 'Disabled elevated mode', fixSafety: FIX_SAFETY['elevated_disabled'] })
        }
      }

      // Fix DM isolation
      if (shouldFix('dm_isolation')) {
        if (!ocConfig.session) ocConfig.session = {}
        if (ocConfig.session.dmScope !== 'per-channel-peer') {
          ocConfig.session.dmScope = 'per-channel-peer'
          configChanged = true
          results.push({ id: 'dm_isolation', name: 'DM session isolation', fixed: true, detail: 'Set dmScope to "per-channel-peer"', fixSafety: FIX_SAFETY['dm_isolation'] })
        }
      }

      // Fix exec security
      if (shouldFix('exec_restricted')) {
        if (!ocConfig.tools) ocConfig.tools = {}
        if (!ocConfig.tools.exec) ocConfig.tools.exec = {}
        if (ocConfig.tools.exec.security !== 'allowlist' && ocConfig.tools.exec.security !== 'deny') {
          ocConfig.tools.exec.security = 'allowlist'
          configChanged = true
          results.push({ id: 'exec_restricted', name: 'Exec tool restriction', fixed: true, detail: 'Set exec security to "allowlist"', fixSafety: FIX_SAFETY['exec_restricted'] })
        }
      }

      // Fix Control UI device auth
      if (shouldFix('control_ui_device_auth')) {
        if (ocConfig.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true) {
          ocConfig.gateway.controlUi.dangerouslyDisableDeviceAuth = false
          configChanged = true
          results.push({ id: 'control_ui_device_auth', name: 'Control UI device auth', fixed: true, detail: 'Disabled dangerouslyDisableDeviceAuth', fixSafety: FIX_SAFETY['control_ui_device_auth'] })
        }
      }

      // Fix Control UI insecure auth
      if (shouldFix('control_ui_insecure_auth')) {
        if (ocConfig.gateway?.controlUi?.allowInsecureAuth === true) {
          ocConfig.gateway.controlUi.allowInsecureAuth = false
          configChanged = true
          results.push({ id: 'control_ui_insecure_auth', name: 'Control UI secure auth', fixed: true, detail: 'Disabled allowInsecureAuth', fixSafety: FIX_SAFETY['control_ui_insecure_auth'] })
        }
      }

      // Fix filesystem workspace isolation
      if (shouldFix('fs_workspace_only')) {
        if (!ocConfig.tools) ocConfig.tools = {}
        if (!ocConfig.tools.fs) ocConfig.tools.fs = {}
        if (ocConfig.tools.fs.workspaceOnly !== true) {
          ocConfig.tools.fs.workspaceOnly = true
          configChanged = true
          results.push({ id: 'fs_workspace_only', name: 'Filesystem workspace isolation', fixed: true, detail: 'Set tools.fs.workspaceOnly to true', fixSafety: FIX_SAFETY['fs_workspace_only'] })
        }
      }

      // Fix log redaction
      if (shouldFix('log_redaction')) {
        if (!ocConfig.logging) ocConfig.logging = {}
        if (!ocConfig.logging.redactSensitive) {
          ocConfig.logging.redactSensitive = 'tools'
          configChanged = true
          results.push({ id: 'log_redaction', name: 'Log redaction', fixed: true, detail: 'Set logging.redactSensitive to "tools"', fixSafety: FIX_SAFETY['log_redaction'] })
        }
      }

      if (configChanged) {
        try {
          writeFileSync(configPath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf-8')
        } catch (e: any) {
          results.push({ id: 'config_write', name: 'Write OpenClaw config', fixed: false, detail: e.message })
        }
      }
    }
  }

  // 7. Fix world-writable files (uses execFileSync with find — no user input)
  if (shouldFix('world_writable')) try {
    const cwd = process.cwd()
    const wwOutput = execFileSync('find', [cwd, '-maxdepth', '2', '-perm', '-o+w', '-not', '-type', 'l'], {
      encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (wwOutput) {
      const files = wwOutput.split('\n').filter(Boolean).slice(0, 20)
      let fixedCount = 0
      for (const f of files) {
        try { chmodSync(f, 0o755); fixedCount++ } catch { /* skip */ }
      }
      if (fixedCount > 0) {
        results.push({ id: 'world_writable', name: 'World-writable files', fixed: true, detail: `Fixed permissions on ${fixedCount} file(s)`, fixSafety: FIX_SAFETY['world_writable'] })
      }
    }
  } catch { /* no world-writable files or find not available */ }

  // Audit log
  try {
    const db = getDatabase()
    db.prepare(
      'INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)'
    ).run('security.auto_fix', auth.user.username, JSON.stringify({ fixes: results.filter(r => r.fixed).map(r => r.id) }))
  } catch { /* non-critical */ }

  const fixed = results.filter(r => r.fixed).length
  const failed = results.filter(r => !r.fixed).length
  const remainingChecks = getFailingChecks()
  const remainingAutoFixable = remainingChecks.filter((check) => check.id in FIX_SAFETY).length
  const remainingManual = remainingChecks.length - remainingAutoFixable

  logger.info({ fixed, failed, actor: auth.user.username }, 'Security auto-fix completed')

  return NextResponse.json({
    attempted: results.length,
    fixed,
    failed,
    remaining: remainingChecks.length,
    remainingAutoFixable,
    remainingManual,
    results,
    note: remainingChecks.length > 0
      ? 'Some issues require manual action or additional review. Environment-backed fixes may still require a server restart to fully apply.'
      : 'All currently detected auto-fixable issues have been resolved. Restart the server if you changed environment-backed settings.',
  })
}
