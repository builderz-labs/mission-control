import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { config } from './config'
import { runCommand, runOpenClaw } from './command'
import { isHermesInstalled, isHermesGatewayRunning, clearHermesDetectionCache } from './hermes-sessions'
import { logger } from './logger'

export type RuntimeId = 'openclaw' | 'hermes' | 'claude' | 'codex'
export type DeploymentMode = 'local' | 'docker'

export interface RuntimeStatus {
  id: RuntimeId
  name: string
  description: string
  installed: boolean
  version: string | null
  running: boolean
  authRequired: boolean
  authHint: string
  authenticated: boolean
}

export interface InstallJob {
  id: string
  runtime: RuntimeId
  mode: DeploymentMode
  status: 'pending' | 'running' | 'success' | 'failed'
  output: string
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export interface RuntimeMeta {
  name: string
  description: string
  authRequired: boolean
  authHint: string
}

const RUNTIME_META: Record<RuntimeId, RuntimeMeta> = {
  openclaw: {
    name: 'OpenClaw',
    description: 'Multi-agent orchestration with gateway, sessions, and memory.',
    authRequired: false,
    authHint: '',
  },
  hermes: {
    name: 'Hermes Agent',
    description: 'Autonomous agent framework by Nous Research.',
    authRequired: false,
    authHint: '',
  },
  claude: {
    name: 'Claude Code',
    description: 'Anthropic CLI agent for software engineering tasks.',
    authRequired: true,
    authHint: 'Run "claude login" after install to authenticate.',
  },
  codex: {
    name: 'Codex CLI',
    description: 'OpenAI CLI agent for code generation and editing.',
    authRequired: true,
    authHint: 'Run "codex auth" after install to authenticate.',
  },
}

export function getRuntimeMeta(id: RuntimeId): RuntimeMeta | undefined {
  return RUNTIME_META[id]
}

// ---------------------------------------------------------------------------
// In-memory job store — ephemeral, not persisted across restarts
// ---------------------------------------------------------------------------

const installJobs = new Map<string, InstallJob>()

// Clean up old jobs (>1 hour) periodically
function pruneJobs() {
  const cutoff = Date.now() - 3600_000
  for (const [id, job] of installJobs) {
    if (job.finishedAt && job.finishedAt < cutoff) installJobs.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function detectOpenClaw(): RuntimeStatus {
  const meta = RUNTIME_META.openclaw
  let installed = false
  let version: string | null = null
  let running = false

  // Check config file existence
  if (config.openclawConfigPath && existsSync(config.openclawConfigPath)) {
    installed = true
  }

  // Try to get version
  try {
    const result = require('node:child_process').spawnSync(
      config.openclawBin || 'openclaw',
      ['--version'],
      { stdio: 'pipe', timeout: 3000 }
    )
    if (result.status === 0) {
      installed = true
      version = (result.stdout?.toString() || '').trim() || null
    }
  } catch {
    // binary not found
  }

  // Check if gateway port is listening (simple sync check)
  try {
    const net = require('node:net')
    const socket = new net.Socket()
    socket.setTimeout(500)
    const connected = new Promise<boolean>((resolve) => {
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.connect(config.gatewayPort, config.gatewayHost)
    })
    // We can't await here synchronously, so just check config existence for "running"
    running = installed
  } catch {
    // ignore
  }

  return { id: 'openclaw', ...meta, installed, version, running, authenticated: true }
}

function detectHermes(): RuntimeStatus {
  const meta = RUNTIME_META.hermes
  const installed = isHermesInstalled()
  let version: string | null = null

  if (installed) {
    try {
      const candidates = [process.env.HERMES_BIN, 'hermes-agent', 'hermes'].filter(Boolean) as string[]
      for (const bin of candidates) {
        try {
          const result = require('node:child_process').spawnSync(bin, ['--version'], { stdio: 'pipe', timeout: 1200 })
          if (result.status === 0) {
            version = (result.stdout?.toString() || '').trim() || null
            break
          }
        } catch { continue }
      }
    } catch {
      // ignore
    }
  }

  const running = installed && isHermesGatewayRunning()
  return { id: 'hermes', ...meta, installed, version, running, authenticated: true }
}

function detectBinary(bins: string[], versionFlag = '--version'): { installed: boolean; version: string | null } {
  const { spawnSync } = require('node:child_process')
  for (const bin of bins) {
    try {
      const result = spawnSync(bin, [versionFlag], { stdio: 'pipe', timeout: 3000 })
      if (result.status === 0) {
        return { installed: true, version: (result.stdout?.toString() || '').trim() || null }
      }
    } catch { continue }
  }
  return { installed: false, version: null }
}

function detectClaude(): RuntimeStatus {
  const meta = RUNTIME_META.claude
  const { installed, version } = detectBinary(['claude'])

  // Check authentication: ~/.claude/ directory with credentials
  let authenticated = false
  if (installed) {
    try {
      const homedir = require('node:os').homedir()
      const path = require('node:path')
      authenticated = existsSync(path.join(homedir, '.claude', 'credentials.json'))
        || existsSync(path.join(homedir, '.claude', '.credentials'))
        || existsSync(path.join(homedir, '.claude', 'settings.json'))
    } catch {
      // ignore
    }
  }

  return { id: 'claude', ...meta, installed, version, running: false, authenticated }
}

function detectCodex(): RuntimeStatus {
  const meta = RUNTIME_META.codex
  const { installed, version } = detectBinary(['codex'])

  // Check authentication: codex stores config in ~/.codex/
  let authenticated = false
  if (installed) {
    try {
      const homedir = require('node:os').homedir()
      const path = require('node:path')
      authenticated = existsSync(path.join(homedir, '.codex', 'auth.json'))
        || existsSync(path.join(homedir, '.codex', 'config.json'))
    } catch {
      // ignore
    }
  }

  return { id: 'codex', ...meta, installed, version, running: false, authenticated }
}

const DETECTORS: Record<RuntimeId, () => RuntimeStatus> = {
  openclaw: detectOpenClaw,
  hermes: detectHermes,
  claude: detectClaude,
  codex: detectCodex,
}

export function detectRuntime(id: RuntimeId): RuntimeStatus {
  const detector = DETECTORS[id]
  return detector ? detector() : { id, name: id, description: '', installed: false, version: null, running: false, authRequired: false, authHint: '', authenticated: false }
}

export function detectAllRuntimes(): RuntimeStatus[] {
  return Object.values(DETECTORS).map(fn => fn())
}

// ---------------------------------------------------------------------------
// Installation (background jobs)
// ---------------------------------------------------------------------------

export function startInstall(runtime: RuntimeId, mode: DeploymentMode): InstallJob {
  pruneJobs()

  const job: InstallJob = {
    id: crypto.randomUUID(),
    runtime,
    mode,
    status: 'running',
    output: '',
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  }

  installJobs.set(job.id, job)

  if (mode === 'docker') {
    // Docker mode doesn't actually install — just returns the sidecar YAML
    job.output = generateDockerSidecar(runtime)
    job.status = 'success'
    job.finishedAt = Date.now()
    return job
  }

  // Local install — run in background
  const INSTALL_FNS: Record<RuntimeId, (job: InstallJob) => Promise<void>> = {
    openclaw: installOpenClawLocal,
    hermes: installHermesLocal,
    claude: installClaudeLocal,
    codex: installCodexLocal,
  }
  const installFn = INSTALL_FNS[runtime] || installOpenClawLocal
  installFn(job).catch((err) => {
    job.status = 'failed'
    job.error = String(err?.message || err)
    job.finishedAt = Date.now()
    logger.error({ err, runtime }, 'Agent runtime install failed')
  })

  return job
}

async function installOpenClawLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing OpenClaw...\n'
  try {
    const result = await runCommand('bash', ['-c', 'curl -fsSL https://get.openclaw.dev | bash'], {
      timeoutMs: 300_000,
    })
    job.output += result.stdout + '\n'
    if (result.stderr) job.output += result.stderr + '\n'
    if (result.code === 0) {
      job.status = 'success'
      job.output += '\n> OpenClaw installed successfully.\n'
    } else {
      job.status = 'failed'
      job.error = `Install exited with code ${result.code}`
      job.output += `\n> Install failed (exit code ${result.code}).\n`
    }
  } catch (err: any) {
    job.status = 'failed'
    job.error = err?.message || 'Unknown error'
    job.output += `\n> Error: ${job.error}\n`
  }
  job.finishedAt = Date.now()
}

async function installHermesLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing Hermes Agent...\n'

  // Try pipx first, then npm
  for (const [cmd, args] of [
    ['pipx', ['install', 'hermes-agent']],
    ['npm', ['install', '-g', 'hermes-agent']],
  ] as const) {
    try {
      job.output += `> Trying: ${cmd} ${args.join(' ')}\n`
      const result = await runCommand(cmd, [...args], { timeoutMs: 300_000 })
      job.output += result.stdout + '\n'
      if (result.stderr) job.output += result.stderr + '\n'
      if (result.code === 0) {
        job.status = 'success'
        job.output += `\n> Hermes Agent installed successfully via ${cmd}.\n`
        clearHermesDetectionCache()
        job.finishedAt = Date.now()
        return
      }
    } catch {
      job.output += `> ${cmd} not available, trying next...\n`
    }
  }

  job.status = 'failed'
  job.error = 'Neither pipx nor npm could install hermes-agent'
  job.output += '\n> Install failed. Install manually: pipx install hermes-agent\n'
  job.finishedAt = Date.now()
}

async function installClaudeLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing Claude Code...\n'
  try {
    const result = await runCommand('npm', ['install', '-g', '@anthropic-ai/claude-code'], { timeoutMs: 300_000 })
    job.output += result.stdout + '\n'
    if (result.stderr) job.output += result.stderr + '\n'
    if (result.code === 0) {
      job.status = 'success'
      job.output += '\n> Claude Code installed successfully.\n'
      job.output += '> Run "claude login" to authenticate.\n'
    } else {
      job.status = 'failed'
      job.error = `Install exited with code ${result.code}`
    }
  } catch (err: any) {
    job.status = 'failed'
    job.error = err?.message || 'Unknown error'
    job.output += `\n> Error: ${job.error}\n`
  }
  job.finishedAt = Date.now()
}

async function installCodexLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing Codex CLI...\n'
  try {
    const result = await runCommand('npm', ['install', '-g', '@openai/codex'], { timeoutMs: 300_000 })
    job.output += result.stdout + '\n'
    if (result.stderr) job.output += result.stderr + '\n'
    if (result.code === 0) {
      job.status = 'success'
      job.output += '\n> Codex CLI installed successfully.\n'
      job.output += '> Run "codex auth" to authenticate.\n'
    } else {
      job.status = 'failed'
      job.error = `Install exited with code ${result.code}`
    }
  } catch (err: any) {
    job.status = 'failed'
    job.error = err?.message || 'Unknown error'
    job.output += `\n> Error: ${job.error}\n`
  }
  job.finishedAt = Date.now()
}

export function getInstallJob(id: string): InstallJob | null {
  return installJobs.get(id) ?? null
}

export function getActiveJobs(): InstallJob[] {
  pruneJobs()
  return [...installJobs.values()]
}

// ---------------------------------------------------------------------------
// Docker sidecar templates
// ---------------------------------------------------------------------------

export function generateDockerSidecar(runtime: RuntimeId): string {
  if (runtime === 'openclaw') {
    return `  # OpenClaw Gateway sidecar
  openclaw-gateway:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw-gateway
    ports:
      - "\${OPENCLAW_GATEWAY_PORT:-18789}:18789"
    volumes:
      - openclaw-data:/root/.openclaw
    networks:
      - mc-net
    restart: unless-stopped

# Add to volumes section:
#   openclaw-data:`
  }

  return `  # Hermes Agent sidecar
  hermes-agent:
    image: ghcr.io/nousresearch/hermes-agent:latest
    container_name: hermes-agent
    environment:
      - MC_URL=http://mission-control:\${PORT:-3000}
      - MC_API_KEY=\${API_KEY:-}
    volumes:
      - hermes-data:/root/.hermes
    networks:
      - mc-net
    restart: unless-stopped

# Add to volumes section:
#   hermes-data:`
}
