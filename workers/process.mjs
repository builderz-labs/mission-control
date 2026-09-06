import { spawn } from 'node:child_process'
import { packageFailure } from './command-error.mjs'

export function cleanEnvironment(env = process.env) {
  const selected = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']
    .filter(name => env[name]).map(name => [name, env[name]]))
  return { ...selected, CI: 'true', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Mission Control Fly Worker',
    GIT_AUTHOR_EMAIL: 'fly-worker@mission-control.local', GIT_COMMITTER_NAME: 'Mission Control Fly Worker',
    GIT_COMMITTER_EMAIL: 'fly-worker@mission-control.local', npm_config_update_notifier: 'false' }
}

export function createRunner(deadline, defaults = {}) {
  const active = new Set()
  function terminate(child) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
  async function run(command, args, options = {}) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Job deadline exceeded')
    const timeout = Math.min(remaining, options.timeoutMs || remaining)
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd || defaults.cwd,
        env: options.env || cleanEnvironment(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      active.add(child)
      let output = ''; let diagnostic = ''; let timedOut = false
      const timer = setTimeout(() => { timedOut = true; terminate(child) }, timeout)
      child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-65_536); diagnostic = (diagnostic + chunk.toString()).slice(-8192) })
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-8192) })
      child.stdin.on('error', () => {})
      child.once('error', () => {
        clearTimeout(timer); active.delete(child); reject(new Error(`${options.label || command} could not start`))
      })
      child.once('close', code => {
        clearTimeout(timer); active.delete(child)
        // A package script may leave descendants after its own process exits.
        // They cannot outlive the bounded command group on a disposable worker.
        terminate(child)
        if (timedOut) reject(new Error(`${options.label || command} exceeded the job deadline`))
        else if (code !== 0) reject(packageFailure(options.label || command, code, diagnostic))
        else resolve(output.trim())
      })
      child.stdin.end(options.input || '')
    })
  }
  run.stop = () => { for (const child of active) terminate(child) }
  return run
}

export async function retry(run, command, args, options = {}) {
  try { return await run(command, args, options) } catch {
    return run(command, args, options)
  }
}

