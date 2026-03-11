import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Clamp a number to [min, max], falling back to `fallback` if NaN. */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (isNaN(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const defaultDataDir = path.join(process.cwd(), '.data')
const configuredDataDir = process.env.MISSION_CONTROL_DATA_DIR || defaultDataDir
const buildScratchRoot =
  process.env.MISSION_CONTROL_BUILD_DATA_DIR ||
  path.join(os.tmpdir(), 'mission-control-build')
const resolvedDataDir = isBuildPhase
  ? path.join(buildScratchRoot, `worker-${process.pid}`)
  : configuredDataDir
const resolvedDbPath = isBuildPhase
  ? (process.env.MISSION_CONTROL_BUILD_DB_PATH ||
      path.join(resolvedDataDir, 'mission-control.db'))
  : (process.env.MISSION_CONTROL_DB_PATH ||
      path.join(resolvedDataDir, 'mission-control.db'))
const resolvedTokensPath = isBuildPhase
  ? (process.env.MISSION_CONTROL_BUILD_TOKENS_PATH ||
      path.join(resolvedDataDir, 'mission-control-tokens.json'))
  : (process.env.MISSION_CONTROL_TOKENS_PATH ||
      path.join(resolvedDataDir, 'mission-control-tokens.json'))
const defaultOpenClawStateDir = path.join(os.homedir(), '.openclaw')
const explicitOpenClawConfigPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  process.env.MISSION_CONTROL_OPENCLAW_CONFIG_PATH ||
  ''
const legacyOpenClawHome =
  process.env.OPENCLAW_HOME ||
  process.env.CLAWDBOT_HOME ||
  process.env.MISSION_CONTROL_OPENCLAW_HOME ||
  ''
const openclawStateDir =
  process.env.OPENCLAW_STATE_DIR ||
  process.env.CLAWDBOT_STATE_DIR ||
  legacyOpenClawHome ||
  (explicitOpenClawConfigPath ? path.dirname(explicitOpenClawConfigPath) : defaultOpenClawStateDir)
const openclawConfigPath =
  explicitOpenClawConfigPath ||
  path.join(openclawStateDir, 'openclaw.json')
const openclawWorkspaceDir =
  process.env.OPENCLAW_WORKSPACE_DIR ||
  process.env.MISSION_CONTROL_WORKSPACE_DIR ||
  (openclawStateDir ? path.join(openclawStateDir, 'workspace') : '')
const defaultMemoryDir = (() => {
  if (process.env.OPENCLAW_MEMORY_DIR) return process.env.OPENCLAW_MEMORY_DIR
  // Prefer OpenClaw workspace memory context (daily notes + knowledge-base)
  // when available; fallback to legacy sqlite memory path.
  if (
    openclawWorkspaceDir &&
    (fs.existsSync(path.join(openclawWorkspaceDir, 'memory')) ||
      fs.existsSync(path.join(openclawWorkspaceDir, 'knowledge-base')))
  ) {
    return openclawWorkspaceDir
  }
  return (openclawStateDir ? path.join(openclawStateDir, 'memory') : '') || path.join(defaultDataDir, 'memory')
})()

export const config = {
  claudeHome:
    process.env.MC_CLAUDE_HOME ||
    path.join(os.homedir(), '.claude'),
  dataDir: resolvedDataDir,
  dbPath: resolvedDbPath,
  tokensPath: resolvedTokensPath,
  // Keep openclawHome as a legacy alias for existing code paths.
  openclawHome: openclawStateDir,
  openclawStateDir,
  openclawConfigPath,
  openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
  clawdbotBin: process.env.CLAWDBOT_BIN || 'clawdbot',
  gatewayHost: process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1',
  gatewayPort: clampInt(Number(process.env.OPENCLAW_GATEWAY_PORT || '18789'), 1, 65535, 18789),
  logsDir:
    process.env.OPENCLAW_LOG_DIR ||
    (openclawStateDir ? path.join(openclawStateDir, 'logs') : ''),
  tempLogsDir: process.env.CLAWDBOT_TMP_LOG_DIR || '',
  memoryDir: defaultMemoryDir,
  memoryAllowedPrefixes:
    defaultMemoryDir === openclawWorkspaceDir
      ? ['memory/', 'knowledge-base/']
      : [],
  soulTemplatesDir:
    process.env.OPENCLAW_SOUL_TEMPLATES_DIR ||
    (openclawStateDir ? path.join(openclawStateDir, 'templates', 'souls') : ''),
  homeDir: os.homedir(),
  // Data retention (days). 0 = keep forever. Negative values are clamped to 0.
  retention: {
    activities: clampInt(Number(process.env.MC_RETAIN_ACTIVITIES_DAYS || '90'), 0, 3650, 90),
    auditLog: clampInt(Number(process.env.MC_RETAIN_AUDIT_DAYS || '365'), 0, 3650, 365),
    logs: clampInt(Number(process.env.MC_RETAIN_LOGS_DAYS || '30'), 0, 3650, 30),
    notifications: clampInt(Number(process.env.MC_RETAIN_NOTIFICATIONS_DAYS || '60'), 0, 3650, 60),
    pipelineRuns: clampInt(Number(process.env.MC_RETAIN_PIPELINE_RUNS_DAYS || '90'), 0, 3650, 90),
    tokenUsage: clampInt(Number(process.env.MC_RETAIN_TOKEN_USAGE_DAYS || '90'), 0, 3650, 90),
    gatewaySessions: clampInt(Number(process.env.MC_RETAIN_GATEWAY_SESSIONS_DAYS || '90'), 0, 3650, 90),
  },
}

export function ensureDirExists(dirPath: string) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
