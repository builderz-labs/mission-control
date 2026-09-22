import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { JEV_ASSISTANT_OUTPUT_JSON_SCHEMA, jevAssistantDraftSchema } from '@/lib/jev-assistant-schema'
import type { JevAssistantDraft } from '@/lib/jev-assistant-schema'
import { generateJevApiDraft } from '@/lib/jev-assistant-api'
import { JevAssistantProviderError } from '@/lib/jev-assistant-error'
import { jevAssistantModel, resolveJevAssistantProvider, type JevAssistantProviderKind } from '@/lib/jev-assistant-config'
import { JEV_ASSISTANT_SYSTEM_PROMPT } from '@/lib/jev-assistant-prompt'
export { JevAssistantProviderError } from '@/lib/jev-assistant-error'

let availability: { value: boolean; expiresAt: number } | null = null
let availabilityFlight: Promise<boolean> | null = null

const PROVIDER_ENV_KEYS = [
  'HOME', 'TMPDIR', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
] as const

function providerEnvironment(source: NodeJS.ProcessEnv = process.env, isolatedHome?: string): NodeJS.ProcessEnv {
  // Bound CLI thinking and nested retries within our 60-second attempt deadline.
  // See code.claude.com/docs/en/env-vars (MAX_THINKING_TOKENS and output limits).
  const env: NodeJS.ProcessEnv = {
    CI: '1', NO_COLOR: '1', CLAUDE_CODE_SAFE_MODE: '1', NODE_ENV: source.NODE_ENV || 'production',
    HOME: source.HOME, PATH: '/usr/bin:/bin',
    MAX_THINKING_TOKENS: '1024', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '4096',
    MAX_STRUCTURED_OUTPUT_RETRIES: '2', CLAUDE_CODE_MAX_RETRIES: '1',
    XDG_CONFIG_HOME: isolatedHome ? join(isolatedHome, '.config') : source.XDG_CONFIG_HOME,
  }
  for (const key of PROVIDER_ENV_KEYS) {
    if (source[key]) env[key] = source[key]
  }
  return env
}

function claudeExecutable(): string {
  return process.env.JEV_CLAUDE_BIN?.trim() || join(homedir(), '.local', 'bin', 'claude')
}

async function checkAvailability(): Promise<boolean> {
  const cwd = mkdtempSync(join(tmpdir(), 'mc-jev-auth-'))
  try {
    const executable = claudeExecutable()
    if (!existsSync(executable)) throw new Error('Claude executable not found')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(executable, ['--safe-mode', 'auth', 'status', '--json'], {
            encoding: 'utf8', timeout: 5_000, maxBuffer: 64_000, killSignal: 'SIGKILL',
            cwd, env: providerEnvironment(process.env, cwd),
          }, (error, output) => error ? reject(error) : resolve(output))
        })
        const status = JSON.parse(stdout) as { loggedIn?: boolean }
        if (typeof status.loggedIn !== 'boolean') throw new Error('Invalid auth status')
        availability = { value: status.loggedIn, expiresAt: Date.now() + (status.loggedIn ? 60_000 : 15_000) }
        break
      } catch (error) { if (attempt === 1) throw error }
    }
  } catch { availability = { value: false, expiresAt: Date.now() + 15_000 } }
  finally { try { rmSync(cwd, { recursive: true, force: true }) } catch { /* controlled temp dir */ } }
  return availability?.value ?? false
}

export async function isJevAssistantAvailable(): Promise<boolean> {
  if (availability && availability.expiresAt > Date.now()) return availability.value
  if (!availabilityFlight) availabilityFlight = checkAvailability().finally(() => { availabilityFlight = null })
  return availabilityFlight
}

async function runOnce(prompt: string, signal?: AbortSignal): Promise<JevAssistantDraft> {
  if (!(await isJevAssistantAvailable())) throw new JevAssistantProviderError('JEV_ASSISTANT_UNAVAILABLE', 503)
  if (signal?.aborted) throw new JevAssistantProviderError('JEV_ASSISTANT_CANCELLED', 504)
  const cwd = mkdtempSync(join(tmpdir(), 'mc-jev-assistant-'))
  const model = jevAssistantModel('claude-cli')
  const args = [
    '--print', '--safe-mode', '--restricted', '--disable-slash-commands',
    '--setting-sources', '', '--no-session-persistence', '--no-chrome', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none', '--output-format', 'json', '--model', model,
    '--max-budget-usd', '0.25', '--system-prompt', `${JEV_ASSISTANT_SYSTEM_PROMPT}\nReturn the result with StructuredOutput; do not print a duplicate draft as text first.`,
    '--json-schema', JSON.stringify(JEV_ASSISTANT_OUTPUT_JSON_SCHEMA),
  ]
  return new Promise((resolve, reject) => {
    let proc
    try {
      proc = spawn(claudeExecutable(), args, {
        cwd, stdio: ['pipe', 'pipe', 'pipe'], env: providerEnvironment(process.env, cwd),
        detached: process.platform !== 'win32',
      })
    } catch {
      try { rmSync(cwd, { recursive: true, force: true }) } catch { /* controlled temp dir */ }
      reject(new JevAssistantProviderError('JEV_ASSISTANT_UNAVAILABLE', 503))
      return
    }
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let settled = false
    const finish = (error?: Error, value?: JevAssistantDraft) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try { rmSync(cwd, { recursive: true, force: true }) } catch { /* controlled temp dir */ }
      if (error) reject(error)
      else resolve(value as JevAssistantDraft)
    }
    const stop = (error: Error) => {
      if (process.platform !== 'win32' && proc.pid) {
        try { process.kill(-proc.pid, 'SIGKILL') } catch { proc.kill('SIGKILL') }
      } else proc.kill('SIGKILL')
      finish(error)
    }
    const timer = setTimeout(() => stop(new JevAssistantProviderError('JEV_ASSISTANT_TIMEOUT', 504)), 60_000)
    const onAbort = () => stop(new JevAssistantProviderError('JEV_ASSISTANT_CANCELLED', 504))
    signal?.addEventListener('abort', onAbort, { once: true })
    const collect = (chunk: Buffer, target: 'out' | 'err') => {
      bytes += chunk.length
      if (bytes > 1_000_000) return stop(new JevAssistantProviderError('JEV_ASSISTANT_OUTPUT_LIMIT', 502))
      if (target === 'out') stdout += chunk.toString()
      else stderr += chunk.toString()
    }
    proc.stdout.on('data', (chunk: Buffer) => collect(chunk, 'out'))
    proc.stderr.on('data', (chunk: Buffer) => collect(chunk, 'err'))
    proc.on('error', () => finish(new JevAssistantProviderError('JEV_ASSISTANT_UNAVAILABLE', 503)))
    proc.on('close', (code) => {
      if (code !== 0) return finish(new JevAssistantProviderError(
        /rate|limit|capacity/i.test(stderr) ? 'JEV_ASSISTANT_RATE_LIMITED' : 'JEV_ASSISTANT_PROVIDER_ERROR',
        /rate|limit|capacity/i.test(stderr) ? 429 : 502,
      ))
      try {
        const envelope = JSON.parse(stdout) as { structured_output?: unknown; result?: string; is_error?: boolean }
        if (envelope.is_error) return finish(new JevAssistantProviderError('JEV_ASSISTANT_PROVIDER_ERROR', 502))
        const candidate = envelope.structured_output ?? (envelope.result ? JSON.parse(envelope.result) : null)
        finish(undefined, jevAssistantDraftSchema.parse(candidate))
      } catch { finish(new JevAssistantProviderError('JEV_ASSISTANT_INVALID_OUTPUT', 502)) }
    })
    proc.stdin.end(prompt)
  })
}

export async function generateJevAssistantDraft(prompt: string, signal?: AbortSignal, requested?: JevAssistantProviderKind): Promise<JevAssistantDraft> {
  const provider = resolveJevAssistantProvider(requested)
  if (provider !== 'claude-cli') return generateJevApiDraft(provider, prompt, signal)
  try { return await runOnce(prompt, signal) }
  catch (error) {
    if (signal?.aborted || !(error instanceof JevAssistantProviderError) || error.status === 429) throw error
    return runOnce(prompt, signal)
  }
}

export const __testables = { claudeExecutable, providerEnvironment }
