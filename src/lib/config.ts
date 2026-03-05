import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const defaultDataDir = path.join(process.cwd(), '.data')
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

export const config = {
  claudeHome:
    process.env.MC_CLAUDE_HOME ||
    path.join(os.homedir(), '.claude'),
  dataDir: process.env.MISSION_CONTROL_DATA_DIR || defaultDataDir,
  dbPath:
    process.env.MISSION_CONTROL_DB_PATH ||
    path.join(defaultDataDir, 'mission-control.db'),
  tokensPath:
    process.env.MISSION_CONTROL_TOKENS_PATH ||
    path.join(defaultDataDir, 'mission-control-tokens.json'),
  // Keep openclawHome as a legacy alias for existing code paths.
  openclawHome: openclawStateDir,
  openclawStateDir,
  openclawConfigPath,
  openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
  clawdbotBin: process.env.CLAWDBOT_BIN || 'clawdbot',
  gatewayHost: process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1',
  gatewayPort: Number(process.env.OPENCLAW_GATEWAY_PORT || '18789'),
  logsDir:
    process.env.OPENCLAW_LOG_DIR ||
    (openclawStateDir ? path.join(openclawStateDir, 'logs') : ''),
  tempLogsDir: process.env.CLAWDBOT_TMP_LOG_DIR || '',
  memoryDir:
    process.env.OPENCLAW_MEMORY_DIR ||
    (openclawStateDir ? path.join(openclawStateDir, 'memory') : '') ||
    path.join(defaultDataDir, 'memory'),
  soulTemplatesDir:
    process.env.OPENCLAW_SOUL_TEMPLATES_DIR ||
    (openclawStateDir ? path.join(openclawStateDir, 'templates', 'souls') : ''),
  eddieBrainDir: process.env.MC_EDDIE_BRAIN_DIR || '',
  homeDir: os.homedir(),
  // Data retention (days). 0 = keep forever.
  retention: {
    activities: Number(process.env.MC_RETAIN_ACTIVITIES_DAYS || '90'),
    auditLog: Number(process.env.MC_RETAIN_AUDIT_DAYS || '365'),
    logs: Number(process.env.MC_RETAIN_LOGS_DAYS || '30'),
    notifications: Number(process.env.MC_RETAIN_NOTIFICATIONS_DAYS || '60'),
    pipelineRuns: Number(process.env.MC_RETAIN_PIPELINE_RUNS_DAYS || '90'),
    tokenUsage: Number(process.env.MC_RETAIN_TOKEN_USAGE_DAYS || '90'),
  },
}

export function ensureDirExists(dirPath: string) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
