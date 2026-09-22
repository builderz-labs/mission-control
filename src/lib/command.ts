import { spawn } from 'node:child_process'
import path from 'node:path'
import { config } from './config'

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

export function redactCommandLine(command: string, args: string[]): string {
  const safe = args.map((arg) => (arg.length > 24 || /[\s/'"`$]/.test(arg) ? '[redacted]' : arg))
  return `${command} ${safe.join(' ')}`.trim()
}

const MAX_ERROR_OUTPUT_CHARS = 512

export function summarizeCommandOutput(stdout: string, stderr: string): string {
  const output = (stderr || stdout).trim().replace(/\s+/g, ' ')
  if (!output) return 'no output'
  if (output.length <= MAX_ERROR_OUTPUT_CHARS) return output
  return `${output.slice(0, MAX_ERROR_OUTPUT_CHARS)}… [truncated]`
}

function truncateOutput(output: string): string {
  return output.length <= MAX_ERROR_OUTPUT_CHARS
    ? output
    : `${output.slice(0, MAX_ERROR_OUTPUT_CHARS)}… [truncated]`
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const spawnCommand = path.extname(command).toLowerCase() === '.mjs' ? process.execPath : command
    const spawnArgs = spawnCommand === process.execPath ? [command, ...args] : args
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: options.env,
      shell: false
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | undefined
    let timedOut = false

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        timedOut = true
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

      const enoent = error as NodeJS.ErrnoException
      if (enoent?.code === 'ENOENT') {
        const binHint =
          command === config.openclawBin
            ? 'OPENCLAW_BIN'
            : command === config.clawdbotBin
              ? 'CLAWDBOT_BIN'
              : `${command.toUpperCase()}_BIN`
        const friendly = new Error(
          `Command not found: ${command}. Install it and ensure it is on PATH, or set ${binHint} to an absolute executable path.`
        )
        Object.assign(friendly, { code: enoent.code })
        reject(friendly)
        return
      }

      reject(error)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }
      if (timedOut) {
        const error = new Error(
          `Command timed out after ${options.timeoutMs}ms (${redactCommandLine(command, args)}): ${summarizeCommandOutput(stdout, stderr)}`
        )
        Object.assign(error, {
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
          code,
          timedOut: true,
        })
        reject(error)
        return
      }
      const error = new Error(
        `Command failed (${redactCommandLine(command, args)}): ${summarizeCommandOutput(stdout, stderr)}`
      )
      Object.assign(error, {
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        code,
      })
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
