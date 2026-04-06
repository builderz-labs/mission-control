// ---------------------------------------------------------------------------
// OpenClaw scanner — validates openclaw.json security settings
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, statSync } from 'node:fs'
import { config } from '@/lib/config'
import { type Category, type Check } from './types'
import { scoreCategory } from './report'

/** Safely cast an unknown value to a plain object for key access. Returns null for non-objects. */
function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}

export function scanOpenClaw(): Category {
  const checks: Check[] = []
  const configPath = config.openclawConfigPath

  if (!configPath || !existsSync(configPath)) {
    checks.push({
      id: 'config_found',
      name: 'OpenClaw config found',
      status: 'warn',
      detail: 'openclaw.json not found — OpenClaw checks skipped',
      fix: 'Set OPENCLAW_HOME or OPENCLAW_CONFIG_PATH in .env',
      severity: 'medium',
    })
    return scoreCategory(checks)
  }

  let ocConfig: Record<string, unknown>
  try {
    ocConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
  } catch {
    checks.push({
      id: 'config_valid',
      name: 'OpenClaw config valid',
      status: 'fail',
      detail: 'openclaw.json could not be parsed',
      fix: 'Check openclaw.json for syntax errors',
      severity: 'high',
    })
    return scoreCategory(checks)
  }

  addConfigFileChecks(checks, configPath)
  addGatewayChecks(checks, ocConfig)
  addToolsChecks(checks, ocConfig)
  addRuntimeChecks(checks, ocConfig)

  return scoreCategory(checks)
}

function addConfigFileChecks(checks: Check[], configPath: string): void {
  try {
    const stat = statSync(configPath)
    const mode = (stat.mode & 0o777).toString(8)
    checks.push({
      id: 'config_permissions',
      name: 'Config file permissions',
      status: mode === '600' ? 'pass' : 'warn',
      detail: `openclaw.json permissions are ${mode}`,
      fix: mode !== '600' ? `Run: chmod 600 ${configPath}` : '',
      severity: 'medium',
      fixSafety: 'safe',
    })
  } catch { /* stat failure is non-fatal for security scan */ }
}

function addGatewayChecks(checks: Check[], ocConfig: Record<string, unknown>): void {
  const gw = asObj(ocConfig['gateway'])
  const gwAuth = asObj(gw?.['auth'])
  const tokenOk = gwAuth?.['mode'] === 'token' && String(gwAuth?.['token'] ?? '').trim().length > 0
  const passwordOk = gwAuth?.['mode'] === 'password' && String(gwAuth?.['password'] ?? '').trim().length > 0
  const authOk = tokenOk || passwordOk
  checks.push({
    id: 'gateway_auth',
    name: 'Gateway authentication',
    status: authOk ? 'pass' : 'fail',
    detail: tokenOk
      ? 'Token auth enabled'
      : passwordOk
        ? 'Password auth enabled'
        : `Auth mode: ${gwAuth?.['mode'] || 'none'} (credential required)`,
    fix: !authOk
      ? 'Set gateway.auth.mode to "token" with gateway.auth.token, or "password" with gateway.auth.password'
      : '',
    severity: 'critical',
  })

  const gwBind = gw?.['bind']
  checks.push({
    id: 'gateway_bind',
    name: 'Gateway bind address',
    status: gwBind === 'loopback' || gwBind === '127.0.0.1' ? 'pass' : 'fail',
    detail: `Gateway bind: ${gwBind || 'not set'}`,
    fix: gwBind !== 'loopback' ? 'Set gateway.bind to "loopback" to prevent external access' : '',
    severity: 'critical',
  })

  const controlUi = asObj(gw?.['controlUi'])
  if (controlUi) {
    checks.push({
      id: 'control_ui_device_auth',
      name: 'Control UI device auth',
      status: controlUi['dangerouslyDisableDeviceAuth'] === true ? 'fail' : 'pass',
      detail: controlUi['dangerouslyDisableDeviceAuth'] === true
        ? 'DANGEROUS: dangerouslyDisableDeviceAuth is enabled — device identity checks are bypassed'
        : 'Control UI device auth is active',
      fix: controlUi['dangerouslyDisableDeviceAuth'] === true
        ? 'Set gateway.controlUi.dangerouslyDisableDeviceAuth to false unless in a break-glass scenario'
        : '',
      severity: 'critical',
    })

    checks.push({
      id: 'control_ui_insecure_auth',
      name: 'Control UI secure auth',
      status: controlUi['allowInsecureAuth'] === true ? 'warn' : 'pass',
      detail: controlUi['allowInsecureAuth'] === true
        ? 'allowInsecureAuth is enabled — consider HTTPS or localhost-only access'
        : 'Insecure auth toggle is disabled',
      fix: controlUi['allowInsecureAuth'] === true
        ? 'Set gateway.controlUi.allowInsecureAuth to false, use HTTPS (Tailscale Serve) or localhost'
        : '',
      severity: 'high',
    })
  }
}

function addToolsChecks(checks: Check[], ocConfig: Record<string, unknown>): void {
  const tools = asObj(ocConfig['tools'])
  const toolsProfile = tools?.['profile']
  checks.push({
    id: 'tools_restricted',
    name: 'Tool permissions restricted',
    status: toolsProfile && toolsProfile !== 'all' ? 'pass' : 'warn',
    detail: `Tools profile: ${toolsProfile || 'default'}`,
    fix: toolsProfile === 'all' ? 'Use a restrictive tools profile like "messaging" or "coding"' : '',
    severity: 'low',
  })

  const elevated = asObj(ocConfig['elevated'])?.['enabled']
  checks.push({
    id: 'elevated_disabled',
    name: 'Elevated mode disabled',
    status: elevated !== true ? 'pass' : 'fail',
    detail: elevated === true ? 'Elevated mode is enabled' : 'Elevated mode is disabled',
    fix: elevated === true ? 'Set elevated.enabled to false unless explicitly needed' : '',
    severity: 'high',
  })

  const toolsExec = asObj(tools?.['exec'])
  const execSecurity = toolsExec?.['security']
  checks.push({
    id: 'exec_restricted',
    name: 'Exec tool restricted',
    status: execSecurity === 'deny' || execSecurity === 'allowlist' ? 'pass' : 'warn',
    detail: `Exec security: ${execSecurity || 'default'}`,
    fix: execSecurity !== 'deny' && execSecurity !== 'allowlist'
      ? 'Set tools.exec.security to "deny" or "allowlist"'
      : '',
    severity: 'high',
  })

  const fsWorkspaceOnly = asObj(tools?.['fs'])?.['workspaceOnly']
  checks.push({
    id: 'fs_workspace_only',
    name: 'Filesystem workspace isolation',
    status: fsWorkspaceOnly === true ? 'pass' : 'warn',
    detail: fsWorkspaceOnly === true
      ? 'File operations restricted to workspace directory'
      : 'Agents can access files outside the workspace',
    fix: fsWorkspaceOnly !== true
      ? 'Set tools.fs.workspaceOnly to true to restrict file access to the workspace'
      : '',
    severity: 'medium',
  })

  const toolsDeny = tools?.['deny']
  const dangerousGroups = ['group:automation', 'group:runtime', 'group:fs']
  const deniedGroups = Array.isArray(toolsDeny)
    ? dangerousGroups.filter(g => (toolsDeny as string[]).includes(g))
    : []
  checks.push({
    id: 'tools_deny_list',
    name: 'Dangerous tool groups denied',
    status: deniedGroups.length >= 2 ? 'pass' : 'warn',
    detail: Array.isArray(toolsDeny) && toolsDeny.length > 0
      ? `Denied: ${(toolsDeny as string[]).join(', ')}`
      : 'No tool deny list configured',
    fix: deniedGroups.length < 2
      ? 'Add tools.deny: ["group:automation", "group:runtime", "group:fs"] for agents that don\'t need them'
      : '',
    severity: 'low',
  })

  const safeBins = toolsExec?.['safeBins']
  if (Array.isArray(safeBins) && safeBins.length > 0) {
    const interpreters = ['python', 'python3', 'node', 'bun', 'deno', 'ruby', 'perl', 'bash', 'sh', 'zsh']
    const unsafeInterpreters = (safeBins as string[]).filter(b => interpreters.includes(b))
    const safeBinProfiles = asObj(toolsExec?.['safeBinProfiles']) ?? {}
    const unprofiledInterps = unsafeInterpreters.filter(b => !safeBinProfiles[b])
    checks.push({
      id: 'safe_bins_interpreters',
      name: 'Safe bins interpreter profiling',
      status: unprofiledInterps.length === 0 ? 'pass' : 'warn',
      detail: unprofiledInterps.length > 0
        ? `Interpreter binaries without profiles: ${unprofiledInterps.join(', ')}`
        : 'All interpreter binaries in safeBins have hardened profiles',
      fix: unprofiledInterps.length > 0
        ? `Define tools.exec.safeBinProfiles for: ${unprofiledInterps.join(', ')} — or remove them from safeBins`
        : '',
      severity: 'medium',
    })
  }
}

function addRuntimeChecks(checks: Check[], ocConfig: Record<string, unknown>): void {
  const dmScope = asObj(ocConfig['session'])?.['dmScope']
  checks.push({
    id: 'dm_isolation',
    name: 'DM session isolation',
    status: dmScope === 'per-channel-peer' ? 'pass' : 'warn',
    detail: `DM scope: ${dmScope || 'default'}`,
    fix: dmScope !== 'per-channel-peer'
      ? 'Set session.dmScope to "per-channel-peer" to prevent context leakage'
      : '',
    severity: 'medium',
  })

  const logRedact = asObj(ocConfig['logging'])?.['redactSensitive']
  checks.push({
    id: 'log_redaction',
    name: 'Log redaction enabled',
    status: logRedact ? 'pass' : 'warn',
    detail: logRedact ? `Log redaction: ${logRedact}` : 'Sensitive data redaction is not configured',
    fix: !logRedact ? 'Set logging.redactSensitive to "tools" to prevent secrets leaking into logs' : '',
    severity: 'low',
  })

  const agentDefaults = asObj(asObj(ocConfig['agents'])?.['defaults'])
  const sandboxMode = asObj(agentDefaults?.['sandbox'])?.['mode']
  checks.push({
    id: 'sandbox_mode',
    name: 'Agent sandbox mode',
    status: sandboxMode === 'all' ? 'pass' : 'warn',
    detail: sandboxMode ? `Sandbox mode: ${sandboxMode}` : 'No default sandbox mode configured',
    fix: sandboxMode !== 'all'
      ? 'Set agents.defaults.sandbox.mode to "all" for full isolation (recommended for untrusted inputs)'
      : '',
    severity: 'medium',
  })
}
