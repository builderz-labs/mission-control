import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from './config'

let cachedCliConfigPath: string | null = null

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0'
}

function ensureCliConfigForRemoteGateway(): string | null {
  if (isLoopbackHost(config.gatewayHost)) return null
  if (cachedCliConfigPath && fs.existsSync(cachedCliConfigPath)) return cachedCliConfigPath
  const url = `ws://${config.gatewayHost}:${config.gatewayPort}`
  const cliConfig = {
    gateway: {
      mode: 'remote',
      remote: { url },
      auth: {
        mode: 'token',
        token: { source: 'env', provider: 'default', id: 'OPENCLAW_GATEWAY_TOKEN' },
      },
    },
  }
  const target = path.join(os.tmpdir(), 'mc-openclaw-cli.json')
  try {
    fs.writeFileSync(target, JSON.stringify(cliConfig), { mode: 0o600 })
    cachedCliConfigPath = target
    return target
  } catch {
    return null
  }
}

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  input?: string
  onData?: (chunk: string) => void
}

interface CommandResult {
  stdout: string
  stderr: string
  code: number | null
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | undefined

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
      }, options.timeoutMs)
    }

    child.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      options.onData?.(chunk)
    })

    child.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderr += chunk
      options.onData?.(chunk)
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(error)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }
      const error = new Error(
        `Command failed (${command} ${args.join(' ')}): ${stderr || stdout}`
      )
      ;(error as any).stdout = stdout
      ;(error as any).stderr = stderr
      ;(error as any).code = code
      reject(error)
    })

    if (options.input) {
      child.stdin.write(options.input)
      child.stdin.end()
    }
  })
}

export function runOpenClaw(args: string[], options: CommandOptions = {}) {
  // Explicitly pass OPENCLAW_STATE_DIR so the CLI uses the exact resolved path.
  // Without this, the CLI may interpret OPENCLAW_HOME as a parent directory and
  // append ".openclaw" to it — causing double-nesting when OPENCLAW_HOME is
  // already set to the state directory (e.g. /root/.openclaw → /root/.openclaw/.openclaw).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_STATE_DIR: config.openclawStateDir,
    ...options.env,
  }
  // When MC points at a remote gateway (e.g. running in a container that talks
  // to the host's gateway via host.docker.internal), the bundled CLI would
  // otherwise read the host's openclaw.json (possibly bind-mounted read-only
  // into the container) with gateway.mode=local and try to probe its own
  // loopback — causing every subcommand to hang indefinitely. Pin the CLI to
  // a minimal remote-mode config in that case, overriding any inherited
  // OPENCLAW_CONFIG_PATH that points at the host config.
  const cliConfigPath = ensureCliConfigForRemoteGateway()
  if (cliConfigPath) env.OPENCLAW_CONFIG_PATH = cliConfigPath
  return runCommand(config.openclawBin, args, {
    ...options,
    env,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}

export function runClawdbot(args: string[], options: CommandOptions = {}) {
  return runCommand(config.clawdbotBin, args, {
    ...options,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}
