import { spawn } from 'node:child_process'
import { config } from './config'

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  input?: string
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
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
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
  return runCommand(config.openclawBin, args, {
    ...options,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}

export function runClawdbot(args: string[], options: CommandOptions = {}) {
  return runCommand(config.clawdbotBin, args, {
    ...options,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}

/**
 * Execute an agent tool call via the OpenClaw gateway.
 *
 * Replaces the legacy `clawdbot -c <rpcFn>` pattern which relied on the
 * now-removed `-c` flag.  Instead, sends a structured message through
 * `openclaw gateway call agent` instructing the agent to invoke the
 * requested tool with the given arguments.
 *
 * @param toolName   - Name of the agent tool (e.g. `sessions_spawn`).
 * @param toolArgs   - Plain object with tool arguments.
 * @param options    - Extra options (timeoutMs, cwd, etc.).
 * @returns The command result with stdout/stderr from the gateway.
 */
export async function runGatewayToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: CommandOptions = {}
): Promise<CommandResult> {
  const idempotencyKey = `mc-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const message =
    `You MUST call the tool "${toolName}" with exactly these arguments and return the result. ` +
    `Do NOT add commentary. Arguments: ${JSON.stringify(toolArgs)}`

  const params = JSON.stringify({
    message,
    sessionId: `mc-rpc-${toolName}`,
    idempotencyKey,
    deliver: false,
  })

  const timeoutMs = options.timeoutMs || 30000

  return runOpenClaw(
    [
      'gateway', 'call', 'agent',
      '--expect-final',
      '--timeout', String(timeoutMs),
      '--params', params,
      '--json',
    ],
    { ...options, timeoutMs: timeoutMs + 5000 }
  )
}
