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
    // Spawn with detached:true so the child gets its own process group (PGID = child.pid).
    // This allows the timeout handler to send SIGKILL to the entire group, which also kills
    // any subprocesses spawned by the child (e.g. openclaw spawns a gateway client process).
    // Without this, killing the parent leaves grandchildren alive with the inherited stdio
    // pipes open, so Node.js never fires the 'close' event until those grandchildren die.
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timeoutId: NodeJS.Timeout | undefined

    // Prevent double-settlement if both timeout and 'close'/'error' fire in the same tick.
    const settleOnce = (fn: () => void) => {
      if (!settled) {
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        fn()
      }
    }

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        // Kill the entire process group to terminate the child and all its descendants.
        try {
          if (child.pid != null && process.platform !== 'win32') {
            // POSIX: kill the process group (PGID = child.pid with detached:true).
            process.kill(-child.pid, 'SIGKILL')
          } else {
            child.kill('SIGKILL')
          }
        } catch {
          try { child.kill('SIGKILL') } catch { /* already exited */ }
        }
        // Reject immediately — do NOT wait for the 'close' event because orphaned
        // grandchildren may keep the stdio pipes open until their own timeout fires.
        settleOnce(() => {
          const err = new Error(
            `Command timed out after ${options.timeoutMs}ms (${command} ${args.join(' ')})`
          )
          ;(err as any).stdout = stdout
          ;(err as any).stderr = stderr
          ;(err as any).code = null
          reject(err)
        })
      }, options.timeoutMs)
    }

    child.stdout?.on('data', (data) => {
      if (!settled) stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      if (!settled) stderr += data.toString()
    })

    child.on('error', (error) => {
      settleOnce(() => reject(error))
    })

    child.on('close', (code) => {
      settleOnce(() => {
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
