import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export interface FleetCliResult {
  text: string | null
  sessionId: string | null
}

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export function resolveGrokCliPath(): string | null {
  return firstExisting([
    process.env.GROK_BIN || '',
    join(homedir(), '.grok', 'bin', 'grok'),
    join(homedir(), '.local', 'bin', 'grok'),
    '/usr/local/bin/grok',
  ])
}

export function resolveKimiCliPath(): string | null {
  return firstExisting([
    process.env.KIMI_BIN || '',
    join(homedir(), '.kimi-code', 'bin', 'kimi'),
    join(homedir(), '.local', 'bin', 'kimi'),
    '/usr/local/bin/kimi',
  ])
}

function runCli(
  bin: string,
  args: string[],
  options: { cwd?: string | null; env?: NodeJS.ProcessEnv; timeoutMs?: number; label: string },
): Promise<FleetCliResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    })
    let stdout = ''
    let stderr = ''
    const timeoutMs = options.timeoutMs ?? 180_000
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`${options.label} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        return reject(new Error(`${options.label} exited ${code}: ${(stderr || stdout).slice(0, 500)}`))
      }
      resolve({ text: stdout.trim() || null, sessionId: null })
    })
  })
}

export async function runGrokPrompt(
  prompt: string,
  options: { model?: string; cwd?: string | null } = {},
): Promise<FleetCliResult> {
  const bin = resolveGrokCliPath()
  if (!bin) throw new Error('Grok CLI not available')
  const dir = mkdtempSync(join(tmpdir(), 'mc-grok-dispatch-'))
  const promptFile = join(dir, 'prompt.txt')
  writeFileSync(promptFile, prompt, 'utf8')
  const args = ['--always-approve', '--prompt-file', promptFile]
  if (options.model) args.push('--model', options.model)
  try {
    return await runCli(bin, args, { cwd: options.cwd, label: 'grok CLI' })
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

export async function runKimiPrompt(
  prompt: string,
  options: { model?: string; cwd?: string | null } = {},
): Promise<FleetCliResult> {
  const bin = resolveKimiCliPath()
  if (!bin) throw new Error('Kimi CLI not available')
  const args = ['--auto', '-p', prompt]
  if (options.model) args.push('--model', options.model)
  return runCli(bin, args, { cwd: options.cwd, label: 'kimi CLI' })
}
