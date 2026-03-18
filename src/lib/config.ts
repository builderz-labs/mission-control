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
// Avoid defaulting to ~/.openclaw when HOME is invalid (e.g. Docker nextjs user: /nonexistent)
const safeHomedir = (() => {
  const h = os.homedir()
  return h && h !== '/nonexistent' ? h : ''
})()
const defaultOpenClawStateDir = safeHomedir ? path.join(safeHomedir, '.openclaw') : ''
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
  (openclawStateDir ? path.join(openclawStateDir, 'openclaw.json') : '')

// Hermes: default ~/.hermes (or HERMES_HOME). Gateway config is gateway.json under that dir.
const hermesHome = (process.env.HERMES_HOME || '').trim() || (safeHomedir ? path.join(safeHomedir, '.hermes') : '')
const hermesGatewayJsonPath = hermesHome ? path.join(hermesHome, 'gateway.json') : ''
/** Gateway config file: prefer Hermes gateway.json when HERMES_HOME is set, else openclaw.json */
const effectiveGatewayConfigPath =
  hermesGatewayJsonPath || (openclawConfigPath || null) || null
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

const resolvedGnapRepoPath =
  process.env.GNAP_REPO_PATH || path.join(configuredDataDir, '.gnap')

// When running in Docker, 127.0.0.1 is the container. Default to host-gateway so the host's gateway is reachable (docker-compose extra_hosts).
const envGatewayHost = (process.env.HERMES_GATEWAY_HOST || process.env.OPENCLAW_GATEWAY_HOST || process.env.GATEWAY_HOST || '').trim()
const defaultGatewayHost = envGatewayHost || (fs.existsSync('/.dockerenv') ? 'host-gateway' : '127.0.0.1')

const effectiveHomeDir = safeHomedir || process.cwd()

export const config = {
  claudeHome:
    process.env.MC_CLAUDE_HOME ||
    path.join(effectiveHomeDir, '.claude'),
  dataDir: resolvedDataDir,
  dbPath: resolvedDbPath,
  tokensPath: resolvedTokensPath,
  // Keep openclawHome as a legacy alias for existing code paths.
  openclawHome: openclawStateDir,
  openclawStateDir,
  openclawConfigPath,
  /** Prefer Hermes gateway.json when HERMES_HOME is set; else openclaw.json. Use this for gateway config read/write. */
  gatewayConfigPath: effectiveGatewayConfigPath,
  hermesHome: hermesHome || null,
  hermesGatewayJsonPath: hermesGatewayJsonPath || null,
  openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
  clawdbotBin: process.env.CLAWDBOT_BIN || 'clawdbot',
  gatewayHost: defaultGatewayHost,
  gatewayPort: clampInt(Number(process.env.HERMES_GATEWAY_PORT || process.env.OPENCLAW_GATEWAY_PORT || '18789'), 1, 65535, 18789),
  /** Hermes OpenAI-compatible API server (GET /health, /v1/models). Default 8642. Set HERMES_API_SERVER_PORT=8642 and API_SERVER_KEY for auth. */
  hermesApiServerHost: (process.env.HERMES_API_SERVER_HOST || '').trim() || defaultGatewayHost,
  hermesApiServerPort: clampInt(Number(process.env.HERMES_API_SERVER_PORT || '8642'), 1, 65535, 8642),
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
  homeDir: effectiveHomeDir,
  gnap: {
    enabled: process.env.GNAP_ENABLED === 'true',
    repoPath: resolvedGnapRepoPath,
    autoSync: process.env.GNAP_AUTO_SYNC !== 'false',
    remoteUrl: process.env.GNAP_REMOTE_URL || '',
  },
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
