import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { config } from './config'
import { resolveWithin } from './safe-home-path'
import { logger } from './logger'
import { isTreeKind, projectSlugOf } from './chat-session-identity'
import { scanForInjection } from './injection-guard'
import type { TranscriptMessage } from './session-transcript-types'

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/

function yamlScalar(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 240)
}

function safeSegment(value: string, fallback: string): string {
  const trimmed = value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
  return SAFE_SEGMENT.test(trimmed) ? trimmed : fallback
}

export function archivePath(kind: string, projectSlug: string, sessionId: string): string {
  return join(
    'sessions',
    safeSegment(projectSlug, 'unknown'),
    safeSegment(kind, 'session'),
    `${safeSegment(sessionId, 'id')}.md`,
  )
}

export function renderTranscriptBody(messages: TranscriptMessage[]): string {
  const lines: string[] = []
  for (const message of messages.slice(-40)) {
    const text = message.parts
      .map((part) => {
        if (part.type === 'text') return part.text
        if (part.type === 'thinking') return `_${part.thinking.slice(0, 400)}_`
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!text) continue
    lines.push(`## ${message.role}`, '', text, '')
  }
  return lines.join('\n')
}

export function parseArchiveMarkdown(markdown: string): TranscriptMessage[] {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, '')
  const chunks = body.split(/^## /m).map((chunk) => chunk.trim()).filter(Boolean)
  const messages: TranscriptMessage[] = []
  for (const chunk of chunks) {
    const [roleLine, ...rest] = chunk.split('\n')
    const role = roleLine.trim()
    const text = rest.join('\n').trim()
    if (!text) continue
    if (role === 'user' || role === 'assistant' || role === 'system') {
      messages.push({ role, parts: [{ type: 'text', text: text.slice(0, 8000) }] })
    }
  }
  return messages
}

export function renderArchiveMarkdown(input: {
  kind: string
  sessionId: string
  projectSlug: string
  workingDir?: string | null
  model?: string
  lastUserPrompt?: string | null
  updatedAt?: number
  body?: string
}): string {
  const prompt = (input.lastUserPrompt || '').trim()
  const body = (input.body || '').trim() || `# Session\n\n${prompt || '_No prompt captured._'}\n`
  return `---
kind: ${yamlScalar(input.kind)}
session_id: ${yamlScalar(input.sessionId)}
project: ${yamlScalar(input.projectSlug)}
working_dir: ${yamlScalar(input.workingDir || '')}
model: ${yamlScalar(input.model || '')}
updated_at: ${input.updatedAt ? new Date(input.updatedAt).toISOString() : ''}
---

${body}`
}

function writeArchiveFile(relative: string, markdown: string, lastActivity?: number): string | null {
  const base = config.memoryDir
  if (!base) return null
  const full = resolveWithin(base, relative)
  if (!full) return null
  try {
    if (existsSync(full)) {
      const mtime = statSync(full).mtimeMs
      if (lastActivity && mtime >= lastActivity) return relative
      const isTranscript = markdown.includes('\n## ')
      const skipMs = isTranscript ? 30_000 : 5 * 60 * 1000
      if (Date.now() - mtime < skipMs) return relative
    }
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, markdown, 'utf8')
    return relative
  } catch (err) {
    logger.warn({ err, path: full }, 'Failed to archive session metadata')
    return null
  }
}

export function archiveSessionMeta(input: {
  kind: string
  sessionId: string
  workingDir?: string | null
  model?: string
  lastUserPrompt?: string | null
  lastActivity?: number
  body?: string
}): string | null {
  if (!isTreeKind(input.kind)) return null
  const prompt = (input.lastUserPrompt || '').trim()
  const report = scanForInjection(prompt || 'ok', { context: 'prompt' })
  if (!report.safe) {
    logger.warn({ kind: input.kind, sessionId: input.sessionId }, 'Skipped session archive: injection scan failed')
    return null
  }
  const projectSlug = projectSlugOf(input.workingDir, 'unknown')
  const markdown = renderArchiveMarkdown({
    kind: input.kind,
    sessionId: input.sessionId,
    projectSlug,
    workingDir: input.workingDir,
    model: input.model,
    lastUserPrompt: input.lastUserPrompt,
    updatedAt: input.lastActivity,
    body: input.body,
  })
  return writeArchiveFile(archivePath(input.kind, projectSlug, input.sessionId), markdown, input.lastActivity)
}

export function archiveSessionTranscript(input: {
  kind: string
  sessionId: string
  workingDir?: string | null
  model?: string
  lastUserPrompt?: string | null
  lastActivity?: number
  messages: TranscriptMessage[]
}): string | null {
  return archiveSessionMeta({
    ...input,
    body: renderTranscriptBody(input.messages),
  })
}

export function archiveListedSessions(sessions: Array<Record<string, unknown>>): number {
  let written = 0
  for (const session of sessions.slice(0, 40)) {
    const kind = typeof session.kind === 'string' ? session.kind : ''
    const sessionId = typeof session.id === 'string' ? session.id : ''
    if (!kind || !sessionId) continue
    const path = archiveSessionMeta({
      kind,
      sessionId,
      workingDir: typeof session.workingDir === 'string' ? session.workingDir : null,
      model: typeof session.model === 'string' ? session.model : undefined,
      lastUserPrompt: typeof session.lastUserPrompt === 'string' ? session.lastUserPrompt : null,
      lastActivity: typeof session.lastActivity === 'number' ? session.lastActivity : undefined,
    })
    if (path) written += 1
  }
  return written
}
