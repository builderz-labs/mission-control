import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { config } from './config'
import { logger } from './logger'

const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000
const MAX_SCANNED_LINES = 20_000

const SESSION_ID_RE = /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ZcodeLaunch {
  /** Executable to spawn: the native `zcode` launcher, or a Node binary for a bundle. */
  bin: string
  /** Args that must precede ZCode's own flags (the bundle path when launched through Node). */
  prefixArgs: string[]
  /** Extra environment needed because the bundle is launched outside the desktop shell. */
  env: Record<string, string>
}

export interface ZcodeSessionStats {
  sessionId: string
  transcriptPath: string
  model: string | null
  userMessages: number
  assistantMessages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastMessageAt: string | null
  isActive: boolean
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function isoFromUnknown(value: unknown): string | null {
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000
    return Number.isNaN(ms) ? null : new Date(ms).toISOString()
  }
  return null
}

/** ZCode ships its CLI as an Electron-bundled `zcode.cjs`; provider config sits two levels up. */
function bundleEnv(bundlePath: string): Record<string, string> {
  const env: Record<string, string> = {}
  const resourcesDir = path.dirname(path.dirname(bundlePath))
  const builtinProvider = path.join(resourcesDir, 'config', 'provider', 'zcode-builtin.json')
  if (existsSync(builtinProvider)) {
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtinProvider
  }
  return env
}

function bundleLaunch(bundlePath: string): ZcodeLaunch | null {
  if (!existsSync(bundlePath)) return null
  return { bin: process.execPath, prefixArgs: [bundlePath], env: bundleEnv(bundlePath) }
}

function installedRoots(): string[] {
  const roots: string[] = []
  if (process.env.ZCODE_HOME) roots.push(process.env.ZCODE_HOME)
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env.ProgramFilesx86 || 'C:\\Program Files (x86)'
    roots.push(
      path.join(local, 'Programs', 'ZCode'),
      path.join(programFiles, 'ZCode'),
      path.join(programFilesX86, 'ZCode'),
    )
  } else if (process.platform === 'darwin') {
    roots.push('/Applications/ZCode.app/Contents/Resources', path.join(os.homedir(), 'Applications', 'ZCode.app', 'Contents', 'Resources'))
  } else {
    roots.push('/opt/ZCode', '/usr/lib/ZCode', '/usr/local/lib/ZCode')
  }
  return roots.filter(Boolean)
}

function fromPathEnv(): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.com', ''] : ['']
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `zcode${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Resolve how to run the ZCode CLI. Explicit override wins so operators can point at a
 * dev build; the bundle branch exists because the desktop installer does not always put a
 * `zcode` launcher on PATH.
 */
export function getZcodeLaunch(): ZcodeLaunch | null {
  const override = (process.env.ZCODE_CLI_BIN || '').trim()
  if (override) {
    if (!existsSync(override)) return null
    if (override.endsWith('.cjs') || override.endsWith('.js')) return bundleLaunch(override)
    return { bin: override, prefixArgs: [], env: {} }
  }

  const onPath = fromPathEnv()
  if (onPath) return { bin: onPath, prefixArgs: [], env: {} }

  for (const root of installedRoots()) {
    const bundle = path.join(root, 'resources', 'glm', 'zcode.cjs')
    const launch = bundleLaunch(bundle)
    if (launch) return launch
  }
  return null
}

let cachedVersion: string | null | undefined

export function clearZcodeDetectionCache(): void {
  cachedVersion = undefined
}

export function isZcodeInstalled(): boolean {
  return getZcodeLaunch() !== null
}

export function getZcodeVersion(): string | null {
  if (cachedVersion !== undefined) return cachedVersion
  const launch = getZcodeLaunch()
  if (!launch) {
    cachedVersion = null
    return null
  }
  try {
    const result = spawnSync(launch.bin, [...launch.prefixArgs, 'version'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, ...launch.env, CI: '1' },
    })
    const output = `${result.stdout || ''}`.trim()
    const match = output.match(/(\d+\.\d+\.\d+[\w.-]*)/)
    cachedVersion = match ? match[1] : (output.split(/\s+/)[1] || null)
  } catch (err) {
    logger.warn({ err }, 'Failed to probe ZCode CLI version')
    cachedVersion = null
  }
  return cachedVersion
}

/** ZCode keeps one `model-io-sess_<uuid>.jsonl` per session under its CLI state dir. */
export function getZcodeRolloutDir(homeDir: string = config.homeDir): string {
  if (process.env.ZCODE_ROLLOUT_DIR) return process.env.ZCODE_ROLLOUT_DIR
  return path.join(homeDir, '.zcode', 'cli', 'rollout')
}

export function isZcodeSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

function sessionIdFromFileName(fileName: string): string | null {
  const match = fileName.match(/^(sess_[0-9a-f-]{36})\.jsonl$/i)
  return match ? match[1] : null
}

function summarizeTranscript(filePath: string): Omit<ZcodeSessionStats, 'sessionId' | 'transcriptPath' | 'isActive'> {
  const stats: Omit<ZcodeSessionStats, 'sessionId' | 'transcriptPath' | 'isActive'> = {
    model: null,
    userMessages: 0,
    assistantMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastMessageAt: null,
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return stats
  }

  const lines = raw.split('\n')
  const limit = Math.min(lines.length, MAX_SCANNED_LINES)
  for (let i = 0; i < limit; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry || typeof entry !== 'object') continue

    const role = typeof entry.role === 'string' ? entry.role
      : typeof entry.message?.role === 'string' ? entry.message.role : null
    if (role === 'user') stats.userMessages += 1
    else if (role === 'assistant') stats.assistantMessages += 1

    if (!stats.model) {
      const model = typeof entry.model === 'string' ? entry.model
        : typeof entry.request?.model === 'string' ? entry.request.model
        : typeof entry.usage?.model === 'string' ? entry.usage.model : null
      if (model) stats.model = model
    }

    const usage = entry.usage && typeof entry.usage === 'object' ? entry.usage : null
    if (usage) {
      const input = toCount(usage.inputTokens ?? usage.input_tokens)
      const output = toCount(usage.outputTokens ?? usage.output_tokens)
      stats.inputTokens += input
      stats.outputTokens += output
      stats.totalTokens += toCount(usage.totalTokens ?? usage.total_tokens) || input + output
    }

    const at = isoFromUnknown(entry.timestamp ?? entry.time ?? entry.createdAt ?? entry.created_at)
    if (at && (!stats.lastMessageAt || at > stats.lastMessageAt)) stats.lastMessageAt = at
  }

  return stats
}

export function scanZcodeSessions(limit = 100, homeDir: string = config.homeDir): ZcodeSessionStats[] {
  const dir = getZcodeRolloutDir(homeDir)
  if (!existsSync(dir)) return []

  const now = Date.now()
  const files = readdirSync(dir)
    .map((name) => ({ name, sessionId: sessionIdFromFileName(name) }))
    .filter((entry): entry is { name: string; sessionId: string } => entry.sessionId !== null)

  const rows: Array<{ mtimeMs: number; stats: ZcodeSessionStats }> = []
  for (const entry of files) {
    const transcriptPath = path.join(dir, entry.name)
    let mtimeMs: number
    try {
      mtimeMs = statSync(transcriptPath).mtimeMs
    } catch {
      continue
    }
    const summary = summarizeTranscript(transcriptPath)
    const lastMs = summary.lastMessageAt ? Date.parse(summary.lastMessageAt) : mtimeMs
    rows.push({
      mtimeMs,
      stats: {
        sessionId: entry.sessionId,
        transcriptPath,
        isActive: Number.isFinite(lastMs) ? now - lastMs < ACTIVE_THRESHOLD_MS : now - mtimeMs < ACTIVE_THRESHOLD_MS,
        ...summary,
      },
    })
  }

  return rows
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(0, limit))
    .map((row) => row.stats)
}

export function isZcodeAuthenticated(homeDir: string = config.homeDir): boolean {
  // Existence only — the file holds OAuth material and is never read here.
  return existsSync(path.join(homeDir, '.zcode', 'v2', 'credentials.json'))
    || existsSync(path.join(homeDir, '.zcode', 'credentials.json'))
}
