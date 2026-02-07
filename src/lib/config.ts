import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const defaultDataDir = path.join(process.cwd(), '.data')
const openclawHome =
  process.env.OPENCLAW_HOME ||
  process.env.CLAWDBOT_HOME ||
  process.env.MISSION_CONTROL_OPENCLAW_HOME ||
  ''

export const config = {
  dataDir: process.env.MISSION_CONTROL_DATA_DIR || defaultDataDir,
  dbPath:
    process.env.MISSION_CONTROL_DB_PATH ||
    path.join(defaultDataDir, 'mission-control.db'),
  tokensPath:
    process.env.MISSION_CONTROL_TOKENS_PATH ||
    path.join(defaultDataDir, 'mission-control-tokens.json'),
  openclawHome,
  openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
  clawdbotBin: process.env.CLAWDBOT_BIN || 'clawdbot',
  gatewayHost: process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1',
  gatewayPort: Number(process.env.OPENCLAW_GATEWAY_PORT || '18789'),
  logsDir:
    process.env.OPENCLAW_LOG_DIR ||
    (openclawHome ? path.join(openclawHome, 'logs') : ''),
  tempLogsDir: process.env.CLAWDBOT_TMP_LOG_DIR || '',
  memoryDir:
    process.env.OPENCLAW_MEMORY_DIR ||
    (openclawHome ? path.join(openclawHome, 'memory') : ''),
  soulTemplatesDir:
    process.env.OPENCLAW_SOUL_TEMPLATES_DIR ||
    (openclawHome ? path.join(openclawHome, 'templates', 'souls') : ''),
  homeDir: os.homedir()
}

export function ensureDirExists(dirPath: string) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
