import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const runtimeCwd = process.cwd()
const normalizedCwd = runtimeCwd.endsWith(path.join('.next', 'standalone'))
  ? path.resolve(runtimeCwd, '..', '..')
  : runtimeCwd
const defaultDataDir = path.join(normalizedCwd, '.data')
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

const defaultProjectsRoot = path.join(os.homedir(), 'mission-control-projects')

const projects = {
  adforge: process.env.ADFORGE_PATH || path.join(os.homedir(), 'ADFORGE'),
  jobforge: process.env.JOBFORGE_PATH || path.join(os.homedir(), 'HOOMAN2.1 - JOBFORGE'),
  maestro: process.env.MAESTRO_PATH || path.join(os.homedir(), 'Maestro'),
}

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
  memoryDir: defaultMemoryDir,
  memoryAllowedPrefixes:
    defaultMemoryDir === openclawWorkspaceDir
      ? ['memory/', 'knowledge-base/']
      : [],
  soulTemplatesDir:
    process.env.OPENCLAW_SOUL_TEMPLATES_DIR ||
    (openclawStateDir ? path.join(openclawStateDir, 'templates', 'souls') : ''),
  homeDir: os.homedir(),
  // Data retention (days). 0 = keep forever.
  retention: {
    activities: Number(process.env.MC_RETAIN_ACTIVITIES_DAYS || '90'),
    auditLog: Number(process.env.MC_RETAIN_AUDIT_DAYS || '365'),
    logs: Number(process.env.MC_RETAIN_LOGS_DAYS || '30'),
    notifications: Number(process.env.MC_RETAIN_NOTIFICATIONS_DAYS || '60'),
    pipelineRuns: Number(process.env.MC_RETAIN_PIPELINE_RUNS_DAYS || '90'),
    tokenUsage: Number(process.env.MC_RETAIN_TOKEN_USAGE_DAYS || '90'),
    gatewaySessions: Number(process.env.MC_RETAIN_GATEWAY_SESSIONS_DAYS || '90'),
  },
  projects,
  llm: {
    provider: (process.env.LLM_PROVIDER || 'anthropic') as 'anthropic' | 'openai' | 'ollama',
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || '',
    budgetPerAgentDay: Number(process.env.LLM_BUDGET_PER_AGENT_DAY || '5'),
    /** Tier-to-model mapping (provider/model-name). Overridable via env. */
    models: {
      fast: process.env.LLM_MODEL_FAST || 'claude-haiku-4-5',
      standard: process.env.LLM_MODEL_STANDARD || 'claude-sonnet-4-5',
      complex: process.env.LLM_MODEL_COMPLEX || 'claude-opus-4-6',
    },
    /** Max tokens per request (safety cap) */
    maxTokens: Number(process.env.LLM_MAX_TOKENS || '4096'),
    /** Rate limit: max LLM calls per agent per minute */
    ratePerAgentPerMinute: Number(process.env.LLM_RATE_PER_AGENT_MINUTE || '20'),
    /** Feature flag — set to 'true' to enable LLM features */
    enabled: process.env.LLM_ENABLED === 'true',
  },
}

export function ensureDirExists(dirPath: string) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function validateEnv(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.NODE_ENV !== 'production') return

  if (!process.env.API_KEY || process.env.API_KEY === 'changeme') {
    console.warn('[config] WARNING: API_KEY is not set or is default value in production')
  }
  if (process.env.LLM_ENABLED === 'true' && !process.env.LLM_API_KEY) {
    console.warn('[config] WARNING: LLM_ENABLED=true but LLM_API_KEY is not set')
  }
}

validateEnv()
