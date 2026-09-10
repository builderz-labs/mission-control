import { promises as fs, constants as fsConstants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from '@/lib/command'
import { SESSION_ID_RE } from '@/lib/jsonl-tail'
import { isSafeHomePath } from '@/lib/safe-home-path'

export const HANDOFF_KINDS = ['claude-code', 'codex-cli', 'grok', 'kimi'] as const
export type HandoffKind = typeof HANDOFF_KINDS[number]
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function isHandoffKind(v: string): v is HandoffKind {
  return (HANDOFF_KINDS as readonly string[]).includes(v)
}
export function isSessionId(v: string): boolean { return SESSION_ID_RE.test(v) }
export function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
export function clipExcerpt(text: string, max = 4000): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max)
}
export function handoffBinName(kind: HandoffKind): string {
  if (kind === 'claude-code') return 'claude'
  if (kind === 'codex-cli') return 'codex'
  return kind
}

export function buildHandoffPrompt(input: {
  title: string; sourceKind: string; sourceId: string; project: string; excerpt: string; note?: string
}): string {
  const excerpt = clipExcerpt(input.excerpt)
  const note = input.note?.trim()
  const parts = [
    'Handoff: continue this work without losing context.',
    `Title: ${clipExcerpt(input.title, 200)}`,
    `Source engine: ${input.sourceKind}`,
    `Source session: ${input.sourceId}`,
    `Project: ${clipExcerpt(input.project, 400)}`,
  ]
  if (excerpt) parts.push(`Last excerpt:\n${excerpt}`)
  if (note) parts.push(`Operator note: ${clipExcerpt(note, 500)}`)
  parts.push('Continue the work from this context. Preserve decisions, constraints, and next steps.')
  return clipExcerpt(parts.join('\n'), 6000)
}

export function parseSpawnedSessionId(output: string): string | null {
  const match = output.match(UUID_RE)
  return match && isSessionId(match[0]) ? match[0] : null
}
export function handoffReply(stdout: string, stderr: string): string {
  return stdout.trim() || stderr.trim() || 'Session handed off, but no text response was returned.'
}
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
export function shQuote(s: string): string { return `'${s.replace(/'/g, "'\\''")}'` }

export interface HandoffCommand {
  command: string
  args: string[]
  input?: string
  cwd?: string
  outputPath?: string
  env?: NodeJS.ProcessEnv
}
interface CommandInput {
  kind: HandoffKind
  resumeId: string | null
  prompt: string
  modelId?: string
  effort?: string
  cwd: string
  bin: string
  outputPath?: string
  extraArgs?: string[]
  env?: NodeJS.ProcessEnv
}

export function buildHandoffCommand(input: CommandInput): HandoffCommand {
  const spec = input.kind === 'claude-code' ? claudeCommand(input)
    : input.kind === 'grok' ? grokCommand(input)
      : input.kind === 'kimi' ? kimiCommand(input)
        : codexCommand(input)
  return { ...spec, env: input.env }
}
function claudeCommand(input: CommandInput): HandoffCommand {
  const args = ['--print']
  if (input.resumeId) args.push('--resume', input.resumeId)
  if (input.modelId) args.push('--model', input.modelId)
  if (input.effort) args.push('--effort', input.effort)
  const cmd = `cd ${shQuote(input.cwd)} && exec ${shQuote(input.bin)} ${args.map(shQuote).join(' ')}`
  return { command: 'sh', args: ['-c', cmd], input: input.prompt }
}
function grokCommand(input: CommandInput): HandoffCommand {
  const args = ['-p']
  if (input.resumeId) args.push('--resume', input.resumeId)
  if (input.modelId) args.push('--model', input.modelId)
  if (input.effort) args.push('--effort', input.effort)
  return { command: input.bin, args, input: input.prompt, cwd: input.cwd }
}
function kimiCommand(input: CommandInput): HandoffCommand {
  const args: string[] = []
  if (input.resumeId) args.push('-S', input.resumeId)
  args.push('-p')
  if (input.modelId) args.push('-m', input.modelId)
  return { command: input.bin, args, input: input.prompt, cwd: input.cwd }
}
function codexCommand(input: CommandInput): HandoffCommand {
  const outputPath = input.outputPath || '/tmp/mc-codex-handoff.txt'
  const args = [...(input.extraArgs ?? []), 'exec']
  if (input.modelId) args.push('-m', input.modelId)
  if (input.resumeId) args.push('resume', input.resumeId)
  args.push('--skip-git-repo-check', '-o', outputPath)
  return { command: input.bin, args, input: input.prompt, cwd: input.cwd, outputPath }
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: unknown; timedOut?: unknown }
  return err.code === 'ENOENT' || err.timedOut === true
}

export async function runHandoffWithRetry(spec: HandoffCommand): Promise<{ stdout: string; stderr: string }> {
  const options = { timeoutMs: 180_000, input: spec.input, cwd: spec.cwd, env: spec.env }
  try {
    return await runCommand(spec.command, spec.args, options)
  } catch (error) {
    if (!isRetryable(error)) throw error
    return await runCommand(spec.command, spec.args, options)
  }
}

export async function resolveExecutable(name: string): Promise<string> {
  if (name.includes('/')) return name
  const home = os.homedir()
  const candidates = [
    process.env[`${name.toUpperCase()}_BIN`],
    path.join(home, '.local', 'bin', name),
    path.join(home, '.grok', 'bin', name),
    path.join(home, '.kimi-code', 'bin', name),
    `/home/nextjs/.local/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    ...(process.env.PATH || '').split(':').map((dir) => path.join(dir, name)),
  ]
  for (const candidate of candidates) {
    if (!candidate?.endsWith(`/${name}`)) continue
    try { await fs.access(candidate, fsConstants.X_OK); return candidate } catch { /* next */ }
  }
  return name
}

export async function resolveSessionCwd(sessionId: string, project = '', homeDir = os.homedir()): Promise<string> {
  if (project.startsWith('/') && isSafeHomePath(project, homeDir)) return path.resolve(project)
  try {
    const root = path.join(homeDir, '.claude', 'projects')
    for (const encoded of await fs.readdir(root)) {
      const cwd = await readJsonlCwd(path.join(root, encoded, `${sessionId}.jsonl`))
      if (cwd && isSafeHomePath(cwd, homeDir)) return cwd
    }
  } catch { /* missing projects dir */ }
  return homeDir
}
async function readJsonlCwd(filePath: string): Promise<string | null> {
  try {
    const handle = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
      return extractCwd(buf.subarray(0, bytesRead).toString('utf8'))
    } finally { await handle.close() }
  } catch { return null }
}
function extractCwd(head: string): string | null {
  for (const line of head.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed) as { cwd?: unknown }
      if (typeof row.cwd === 'string' && row.cwd.startsWith('/')) return row.cwd
    } catch { /* skip */ }
  }
  return null
}
