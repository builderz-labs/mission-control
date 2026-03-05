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
      // Normal success
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }

      // Heuristic: treat certain benign stderr messages as non-fatal when stdout indicates success.
      // NARROWED: only applies to the specific "Config overwrite" warning from OpenClaw provisioning,
      // combined with an explicit JSON success marker in stdout. This avoids masking real errors.
      // Source: openclaw agents add may emit "Config overwrite" to stderr during workspace init
      // while still succeeding (exit code non-zero on some provisioning paths).
      // DO NOT expand this list without confirming in OpenClaw release notes.
      //
      // JSON success marker: stdout must parse as valid JSON containing "ok":true or "success":true.
      const benignStderr = stderr.includes('Config overwrite') && !stderr.toLowerCase().includes('fatal') && !stderr.toLowerCase().includes('exception')
      let hasJsonSuccess = false
      if (benignStderr) {
        try {
          const parsed = JSON.parse(stdout.trim())
          hasJsonSuccess = parsed?.ok === true || parsed?.success === true
        } catch {
          hasJsonSuccess = false
        }
      }
      if (benignStderr && hasJsonSuccess) {
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
