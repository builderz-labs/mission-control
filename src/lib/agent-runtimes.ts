import crypto from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { config } from './config'
import { runCommand, runOpenClaw } from './command'
import { scanForInjection } from './injection-guard'
import { isHermesInstalled, isHermesGatewayRunning, clearHermesDetectionCache } from './hermes-sessions'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Security review for downloaded installer scripts
// ---------------------------------------------------------------------------

interface ScriptReviewResult {
  safe: boolean
  detail: string
}

/**
 * Download installer script to a secure temp dir, run regex-based injection
 * scan, and optionally request an AI security review via the Claude API.
 *
 * Returns the temp script path on success so the caller can execute it.
 * On failure, cleans up and returns null.
 */
async function downloadAndReviewScript(
  url: string,
  job: InstallJob,
  env: NodeJS.ProcessEnv,
): Promise<{ scriptPath: string; tempDir: string } | null> {
  // 1. Download to unpredictable temp dir (prevents symlink race)
  const tempDir = mkdtempSync(join(tmpdir(), 'mc-install-'))
  const scriptPath = join(tempDir, 'install.sh')

  const hasCurl = await runCommand('which', ['curl'], { timeoutMs: 5_000 })
    .then(r => r.code === 0).catch(() => false)
  const dlCmd = hasCurl
    ? ['curl', ['-fsSL', '-o', scriptPath, url]] as const
    : ['wget', ['-qO', scriptPath, url]] as const

  job.output += `> Downloading installer from ${url}...\n`
  try {
    const dl = await runCommand(dlCmd[0], [...dlCmd[1]], { timeoutMs: 60_000, env })
    if (dl.code !== 0) {
      job.output += `> Download failed (exit ${dl.code})\n`
      rmSync(tempDir, { recursive: true, force: true })
      return null
    }
  } catch (err: any) {
    job.output += `> Download error: ${err.message}\n`
    rmSync(tempDir, { recursive: true, force: true })
    return null
  }

  // 2. Read and scan with injection guard (regex baseline)
  let content: string
  try {
    content = readFileSync(scriptPath, 'utf-8')
  } catch {
    job.output += '> Failed to read downloaded script\n'
    rmSync(tempDir, { recursive: true, force: true })
    return null
  }

  if (!content.trim()) {
    job.output += '> Downloaded script is empty\n'
    rmSync(tempDir, { recursive: true, force: true })
    return null
  }

  const regexReport = scanForInjection(content, { context: 'shell' })
  if (!regexReport.safe) {
    const criticals = regexReport.matches.filter(m => m.severity === 'critical')
    if (criticals.length > 0) {
      job.output += '> SECURITY: Downloaded script blocked by injection guard:\n'
      for (const m of criticals) {
        job.output += `>   [${m.rule}] ${m.description}: ${m.matched}\n`
      }
      rmSync(tempDir, { recursive: true, force: true })
      return null
    }
  }

  // 3. AI security review (if ANTHROPIC_API_KEY is available)
  const aiReview = await reviewScriptWithAI(content, url)
  if (aiReview && !aiReview.safe) {
    job.output += `> SECURITY: AI review flagged the downloaded script:\n>   ${aiReview.detail}\n`
    rmSync(tempDir, { recursive: true, force: true })
    return null
  }
  if (aiReview?.safe) {
    job.output += '> Security review passed (regex + AI)\n'
  } else {
    job.output += '> Security review passed (regex only — set ANTHROPIC_API_KEY for AI review)\n'
  }

  return { scriptPath, tempDir }
}

/**
 * Ask Claude to review a shell script for malicious content.
 * Returns null if ANTHROPIC_API_KEY is not set (graceful skip).
 */
async function reviewScriptWithAI(script: string, sourceUrl: string): Promise<ScriptReviewResult | null> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!apiKey) return null

  // Limit to first 100KB to control cost
  const truncated = script.length > 100_000 ? script.slice(0, 100_000) + '\n# ... truncated ...' : script

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are a security auditor. Analyze this shell script downloaded from ${sourceUrl} for malicious behavior.

Check for: backdoors, data exfiltration (curl/wget to unexpected URLs), credential harvesting, reverse shells, crypto miners, hidden commands in base64/hex, privilege escalation beyond what an installer needs, modification of SSH keys or system auth, phoning home to unexpected domains.

An installer script is EXPECTED to: download binaries, create directories, modify PATH, install packages. These are NOT malicious.

Respond with EXACTLY one line:
- "SAFE: <brief reason>" if the script is a legitimate installer
- "UNSAFE: <brief description of the threat>" if malicious behavior is found

Script:
\`\`\`bash
${truncated}
\`\`\``,
        }],
      }),
    })

    if (!res.ok) {
      logger.warn({ status: res.status }, 'AI script review failed — skipping')
      return null
    }

    const data = await res.json() as { content: Array<{ type: string; text?: string }> }
    const text = data.content?.find(b => b.type === 'text')?.text?.trim() || ''

    if (text.startsWith('UNSAFE:')) {
      return { safe: false, detail: text }
    }
    return { safe: true, detail: text }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'AI script review error — skipping')
    return null
  }
}

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
    description: 'Self-improving AI agent with learning loop, skills, and multi-platform messaging.',
    authRequired: true,
    authHint: 'Run "hermes setup" or configure via Mission Control.',
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
      const path = require('node:path')
      const homeDir = require('node:os').homedir()
      const dataDir = path.resolve(config.dataDir || '.data')
      const candidates = [
        process.env.HERMES_BIN,
        path.join(dataDir, '.local', 'bin', 'hermes'),
        path.join(homeDir, '.local', 'bin', 'hermes'),
        path.join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
        'hermes-agent',
        'hermes',
      ].filter(Boolean) as string[]
      // hermes --version exits non-zero but stdout contains the version banner
      for (const bin of candidates) {
        try {
          if (bin.startsWith('/') && !existsSync(bin)) continue
          const result = require('node:child_process').spawnSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000 })
          const out = (result.stdout?.toString() || '') + (result.stderr?.toString() || '')
          const match = out.match(/Hermes Agent v([\d.]+)/)
          if (match) {
            version = match[1]
            break
          }
        } catch { continue }
      }
    } catch {
      // ignore
    }
  }

  const running = installed && isHermesGatewayRunning()

  // Check if hermes has a provider/model configured
  let authenticated = false
  if (installed) {
    try {
      const homeDir = require('node:os').homedir()
      const configPath = join(homeDir, '.hermes', 'config.yaml')
      if (existsSync(configPath)) {
        const raw = require('node:fs').readFileSync(configPath, 'utf8')
        // Has a model configured = considered authenticated/configured
        authenticated = /^model:\s*\S+/m.test(raw)
      }
    } catch {
      // ignore
    }
  }

  return { id: 'hermes', ...meta, installed, version, running, authenticated }
}

function detectBinary(bins: string[], versionFlag = '--version'): { installed: boolean; version: string | null; resolvedBin: string | null } {
  const { spawnSync } = require('node:child_process')
  const homedir = require('node:os').homedir()
  const path = require('node:path')

  // Expand bare binary names with common install locations that may not be on PATH
  const candidates: string[] = []
  for (const bin of bins) {
    if (!bin.includes('/')) {
      candidates.push(
        path.join(homedir, '.local', 'bin', bin),
        path.join('/usr', 'local', 'bin', bin),
        path.join(homedir, 'Library', 'pnpm', bin),  // macOS pnpm global
        path.join(homedir, '.npm-global', 'bin', bin),
      )
    }
    candidates.push(bin)
  }

  for (const bin of candidates) {
    try {
      const result = spawnSync(bin, [versionFlag], { stdio: 'pipe', timeout: 3000 })
      if (result.status === 0) {
        // Extract first meaningful line as version (skip wrapper/logging noise like [lacp])
        const rawOutput = (result.stdout?.toString() || '').trim()
        const versionLine = rawOutput.split('\n').find((l: string) => l.trim() && !l.trim().startsWith('['))?.trim() || rawOutput.split('\n')[0]?.trim() || null
        return { installed: true, version: versionLine, resolvedBin: bin }
      }
    } catch { continue }
  }
  return { installed: false, version: null, resolvedBin: null }
}

function detectClaude(): RuntimeStatus {
  const meta = RUNTIME_META.claude
  const { installed, version, resolvedBin } = detectBinary(['claude'])

  // Detect Claude Code authentication. Claude supports two auth modes:
  //
  // 1. claude.ai subscription (OAuth): stores account info in ~/.claude.json
  //    under the `oauthAccount` key. No credential file is written inside
  //    ~/.claude/ — the managed key lives in memory/keychain.
  //
  // 2. Anthropic Console (API key): may store a `claudeAiOauth` token in
  //    ~/.claude/.credentials.json (created by older versions) or simply
  //    rely on the ANTHROPIC_API_KEY env var.
  //
  // Strategy: check ~/.claude.json first (most common), then
  // ~/.claude/.credentials.json, then fall back to `claude auth status --json`.
  let authenticated = false
  if (installed) {
    try {
      const homedir = require('node:os').homedir()
      const path = require('node:path')
      const fs = require('node:fs')

      // Primary: ~/.claude.json (claude.ai subscription login)
      const claudeJsonPath = path.join(homedir, '.claude.json')
      if (existsSync(claudeJsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'))
        if (parsed.oauthAccount?.emailAddress) {
          authenticated = true
        }
      }

      // Secondary: ~/.claude/.credentials.json (API key / older OAuth flow)
      if (!authenticated) {
        const credPath = path.join(homedir, '.claude', '.credentials.json')
        if (existsSync(credPath)) {
          const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'))
          authenticated = !!(parsed.claudeAiOauth?.accessToken || parsed.apiKey)
        }
      }
    } catch {
      // ignore parse errors
    }

    // Fallback: run `claude auth status --json` (covers env-var API key auth
    // and any future auth mechanisms that don't write a file)
    if (!authenticated) {
      try {
        const { spawnSync } = require('node:child_process')
        const result = spawnSync(resolvedBin || 'claude', ['auth', 'status', '--json'], {
          stdio: 'pipe',
          timeout: 5000,
        })
        if (result.status === 0) {
          const json = JSON.parse(result.stdout?.toString() || '{}')
          authenticated = json.loggedIn === true
        }
      } catch {
        // ignore — binary may not support --json flag in older versions
      }
    }
  }

  return { id: 'claude', ...meta, installed, version, running: false, authenticated }
}

function detectCodex(): RuntimeStatus {
  const meta = RUNTIME_META.codex
  const { installed, version } = detectBinary(['codex', 'codex-cli'])

  // Codex CLI authenticates via OPENAI_API_KEY env var or config files
  let authenticated = false
  if (installed) {
    try {
      const homedir = require('node:os').homedir()
      const path = require('node:path')
      authenticated = !!process.env.OPENAI_API_KEY
        || existsSync(path.join(homedir, '.codex', 'auth.json'))
        || existsSync(path.join(homedir, '.codex', 'config.json'))
        || existsSync(path.join(homedir, '.config', 'codex', 'config.json'))
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

// ---------------------------------------------------------------------------
// Install environment — Docker runs as non-root with HOME=/nonexistent
// ---------------------------------------------------------------------------

function getInstallEnv(): NodeJS.ProcessEnv {
  const path = require('node:path')
  const { mkdirSync } = require('node:fs')
  const dataDir = path.resolve(config.dataDir || '.data')
  const npmPrefix = path.join(dataDir, '.npm-global')
  const homedir = !process.env.HOME || process.env.HOME === '/nonexistent'
    ? dataDir
    : process.env.HOME

  try { mkdirSync(npmPrefix, { recursive: true }) } catch {}
  try { mkdirSync(path.join(homedir, '.npm'), { recursive: true }) } catch {}

  // Include common install destinations in PATH so tools installed by
  // sub-installers (e.g., uv installing Python to ~/.local/bin) are found
  const localBin = path.join(homedir, '.local', 'bin')
  try { mkdirSync(localBin, { recursive: true }) } catch {}

  return {
    ...process.env,
    HOME: homedir,
    npm_config_prefix: npmPrefix,
    npm_config_cache: path.join(homedir, '.npm'),
    PATH: `${localBin}:${npmPrefix}/bin:${homedir}/bin:/usr/local/bin:${process.env.PATH || ''}`,
  }
}

async function runInstallCmd(cmd: string, args: string[], job: InstallJob): Promise<boolean> {
  const env = getInstallEnv()
  job.output += `> ${cmd} ${args.join(' ')}\n`
  try {
    const result = await runCommand(cmd, args, { timeoutMs: 300_000, env })
    if (result.stdout) job.output += result.stdout + '\n'
    if (result.stderr) job.output += result.stderr + '\n'
    return result.code === 0
  } catch (err: any) {
    job.output += `> Error: ${err?.message || 'command not found'}\n`
    return false
  }
}

async function installOpenClawLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing OpenClaw...\n'
  const env = {
    ...getInstallEnv(),
    NONINTERACTIVE: '1',
    CI: '1',
  }
  try {
    // Download, review, then execute from secure temp dir
    const reviewed = await downloadAndReviewScript('https://get.openclaw.dev', job, env)
    if (!reviewed) {
      job.status = 'failed'
      job.error = 'Installer download or security review failed'
      job.finishedAt = Date.now()
      return
    }

    const result = await runCommand('bash', [reviewed.scriptPath, '--non-interactive'], {
      timeoutMs: 300_000, env,
      onData: (chunk) => { job.output += chunk },
    })

    rmSync(reviewed.tempDir, { recursive: true, force: true })

    // Verify the binary actually exists after install
    const { installed: verified } = detectBinary([config.openclawBin || 'openclaw'])

    if (result.code === 0 && verified) {
      job.output += '\n> OpenClaw installed. Running initial setup...\n'
      try {
        const onboard = await runCommand('openclaw', ['onboard', '--non-interactive'], { timeoutMs: 60_000, env })
        if (onboard.stdout) job.output += onboard.stdout + '\n'
        if (onboard.stderr) job.output += onboard.stderr + '\n'
      } catch {
        job.output += '> Note: "openclaw onboard" skipped (run manually if needed).\n'
      }
      job.status = 'success'
      job.output += '\n> OpenClaw installed successfully.\n'
    } else if (result.code === 0 && !verified) {
      job.status = 'failed'
      job.error = 'Install command succeeded but openclaw binary was not found. curl may not be installed.'
      job.output += '\n> Install command ran but openclaw was not detected. Is curl installed?\n'
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
  job.output += '> Installing Hermes Agent via official installer...\n'
  const env = {
    ...getInstallEnv(),
    // Non-interactive: prevent installer from reading /dev/tty
    HERMES_NONINTERACTIVE: '1',
    NONINTERACTIVE: '1',
    CI: '1',
    DEBIAN_FRONTEND: 'noninteractive',
  }
  try {
    const hermesUrl = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh'

    // Download, review, then execute from secure temp dir
    const reviewed = await downloadAndReviewScript(hermesUrl, job, env)
    if (!reviewed) {
      job.status = 'failed'
      job.error = 'Installer download or security review failed'
      job.finishedAt = Date.now()
      return
    }

    // Patch /dev/tty check for non-TTY environments before running
    await runCommand('sed', ['-i.bak', 's/\\[ -e \\/dev\\/tty \\]/false/g', reviewed.scriptPath], { timeoutMs: 5_000 }).catch(() => {})

    const result = await runCommand('bash', [reviewed.scriptPath, '--skip-setup'], {
      timeoutMs: 600_000, env,
      onData: (chunk) => { job.output += chunk },
    })

    rmSync(reviewed.tempDir, { recursive: true, force: true })

    // Verify install actually worked — check for the binary
    clearHermesDetectionCache()
    logger.info({ dataDir: config.dataDir, homeDir: require('node:os').homedir() }, 'Verifying hermes install...')
    const verified = isHermesInstalled()
    logger.info({ verified }, 'Hermes install verification result')

    if (result.code === 0 && verified) {
      job.status = 'success'
      job.output += '\n> Hermes Agent installed successfully.\n'
      job.output += '> Run "hermes" to start chatting, or "hermes setup" for full configuration.\n'
    } else if (result.code === 0 && !verified) {
      job.status = 'failed'
      job.error = 'Install command succeeded but hermes binary was not found. curl may not be installed.'
      job.output += '\n> Install command ran but hermes was not detected. Is curl installed?\n'
    } else {
      job.status = 'failed'
      job.error = `Installer exited with code ${result.code}`
      job.output += `\n> Install failed (exit code ${result.code}).\n`
    }
  } catch (err: any) {
    job.status = 'failed'
    job.error = err?.message || 'Unknown error'
    job.output += `\n> Error: ${job.error}\n`
  }
  job.finishedAt = Date.now()
}

async function installClaudeLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing Claude Code...\n'
  if (await runInstallCmd('npm', ['install', '-g', '@anthropic-ai/claude-code'], job)) {
    job.status = 'success'
    job.output += '\n> Claude Code installed successfully.\n'
    job.output += '> Run "claude login" to authenticate.\n'
  } else {
    job.status = 'failed'
    job.error = 'npm install failed — see output above'
  }
  job.finishedAt = Date.now()
}

async function installCodexLocal(job: InstallJob): Promise<void> {
  job.output += '> Installing Codex CLI...\n'
  if (await runInstallCmd('npm', ['install', '-g', '@openai/codex'], job)) {
    job.status = 'success'
    job.output += '\n> Codex CLI installed successfully.\n'
    job.output += '> Run "codex auth" to authenticate.\n'
  } else {
    job.status = 'failed'
    job.error = 'npm install failed — see output above'
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
