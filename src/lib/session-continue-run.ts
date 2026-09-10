import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from '@/lib/command'
import { getOpenCodeExecutable } from '@/lib/opencode-sessions'
import { parsePermissionMode, permissionArgv, type UnifiedPermissionMode } from '@/lib/permission-connector'
import { resolveExecutable, resolveSessionCwd, shQuote } from '@/lib/session-handoff'

export type ContinueKind = 'claude-code' | 'codex-cli' | 'opencode' | 'grok' | 'kimi'
const LIVE_WINDOW_MS = 60_000
type HostMode = 'coexist' | 'block-active' | 'nudge'

export class ContinueBusyError extends Error {
  readonly status = 409 as const
}

export function isContinueKind(value: string): value is ContinueKind {
  return value === 'claude-code' || value === 'codex-cli' || value === 'opencode'
    || value === 'grok' || value === 'kimi'
}

function hostMode(): HostMode {
  const raw = (process.env.MC_HOST_SESSION_MODE || '').trim().toLowerCase()
  return raw === 'block-active' || raw === 'nudge' ? raw : 'coexist'
}

async function sessionJsonlMtime(sessionId: string): Promise<number | null> {
  const root = path.join(os.homedir(), '.claude', 'projects')
  let entries: string[]
  try { entries = await fs.readdir(root) } catch { return null }
  for (const encoded of entries) {
    try { return (await fs.stat(path.join(root, encoded, `${sessionId}.jsonl`))).mtimeMs } catch { /* next */ }
  }
  return null
}

async function touchSessionJsonl(sessionId: string): Promise<void> {
  const root = path.join(os.homedir(), '.claude', 'projects')
  try {
    for (const encoded of await fs.readdir(root)) {
      try {
        const now = new Date()
        await fs.utimes(path.join(root, encoded, `${sessionId}.jsonl`), now, now)
        return
      } catch { /* next */ }
    }
  } catch { /* best-effort */ }
}

async function runClaude(
  sessionId: string,
  prompt: string,
  modelId?: string,
  effort?: string,
  permissionMode: UnifiedPermissionMode = 'ask',
): Promise<string> {
  const sessionCwd = await resolveSessionCwd(sessionId)
  const claudeBin = await resolveExecutable('claude')
  const mode = hostMode()
  if (mode === 'block-active') {
    const mtimeMs = await sessionJsonlMtime(sessionId)
    if (mtimeMs !== null && Date.now() - mtimeMs < LIVE_WINDOW_MS) {
      throw new ContinueBusyError('Session has a live host CLI; refusing to --resume (mode=block-active). Wait for it to go idle.')
    }
  }
  const runViaShell = async (resume: boolean) => {
    const args = ['--print']
    if (resume) args.push('--resume', sessionId)
    if (modelId) args.push('--model', modelId)
    if (effort) args.push('--effort', effort)
    args.push(...permissionArgv('claude-code', permissionMode))
    const cmd = `cd ${shQuote(sessionCwd)} && exec ${shQuote(claudeBin)} ${args.map(shQuote).join(' ')}`
    return runCommand('sh', ['-c', cmd], { timeoutMs: 180000, input: prompt })
  }
  let result: { stdout: string; stderr: string }
  try {
    result = await runViaShell(true)
  } catch (err: unknown) {
    const stderrText = err && typeof err === 'object' && 'stderr' in err
      ? String((err as { stderr?: unknown }).stderr || '')
      : err instanceof Error ? err.message : ''
    if (!/no conversation found|session.*not found|unknown session/i.test(stderrText)) throw err
    result = await runViaShell(false)
  }
  if (mode === 'nudge') await touchSessionJsonl(sessionId)
  return (result.stdout || '').trim() || (result.stderr || '').trim()
}

async function runCodex(
  sessionId: string,
  prompt: string,
  modelId?: string,
  permissionMode: UnifiedPermissionMode = 'ask',
): Promise<string> {
  const outputPath = path.join('/tmp', `mc-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const args = ['exec', ...permissionArgv('codex-cli', permissionMode)]
  if (modelId) args.push('-m', modelId)
  args.push('resume', sessionId, '--skip-git-repo-check', '-o', outputPath)
  const cwd = await resolveSessionCwd(sessionId)
  try {
    await runCommand(await resolveExecutable('codex'), args, { timeoutMs: 180000, cwd, input: prompt })
  } catch { /* read output anyway */ }
  try { return (await fs.readFile(outputPath, 'utf-8')).trim() } catch { return '' }
  finally { try { await fs.unlink(outputPath) } catch { /* ignore */ } }
}

export async function runSessionContinue(input: {
  kind: ContinueKind
  sessionId: string
  prompt: string
  modelId?: string
  effort?: string
  permissionMode?: UnifiedPermissionMode
}): Promise<string> {
  const mode = parsePermissionMode(input.permissionMode)
  if (input.kind === 'claude-code') return runClaude(input.sessionId, input.prompt, input.modelId, input.effort, mode)
  if (input.kind === 'codex-cli') return runCodex(input.sessionId, input.prompt, input.modelId, mode)
  const cwd = await resolveSessionCwd(input.sessionId)
  if (input.kind === 'grok') {
    const args = ['-p', '--resume', input.sessionId, ...permissionArgv('grok', mode)]
    if (input.modelId) args.push('--model', input.modelId)
    if (input.effort) args.push('--effort', input.effort)
    const result = await runCommand(await resolveExecutable('grok'), args, { timeoutMs: 180000, input: input.prompt, cwd })
    return (result.stdout || '').trim() || (result.stderr || '').trim()
  }
  if (input.kind === 'kimi') {
    const args = ['-S', input.sessionId, '-p', ...permissionArgv('kimi', mode)]
    if (input.modelId) args.push('-m', input.modelId)
    const result = await runCommand(await resolveExecutable('kimi'), args, { timeoutMs: 180000, input: input.prompt, cwd })
    return (result.stdout || '').trim() || (result.stderr || '').trim()
  }
  const result = await runCommand(getOpenCodeExecutable(), ['run', '--session', input.sessionId], {
    timeoutMs: 180000,
    input: input.prompt,
    cwd,
  })
  return (result.stdout || '').trim() || (result.stderr || '').trim()
}
