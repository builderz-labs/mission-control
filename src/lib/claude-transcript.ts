import { join } from 'node:path'
import { config } from './config'
import { findNamedJsonl, readJsonlTailLines, TRANSCRIPT_TAIL_BYTES } from './jsonl-tail'
import { assistantParts, attachToolResults, dedupeConsecutiveText } from './claude-transcript-parts'
import { isNoiseUserText, pushMessage, textPart, type TranscriptMessage } from './session-transcript-types'

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function findClaudeTranscriptFile(sessionId: string, root = join(config.claudeHome, 'projects')): string | null {
  return findNamedJsonl(root, sessionId)
}

export function parseClaudeTranscriptLines(lines: string[], sessionId: string, limit: number): TranscriptMessage[] {
  const out: TranscriptMessage[] = []
  for (const line of lines) {
    if (line.length > 400_000) continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    const entry = rec(parsed)
    if (!entry || str(entry.sessionId) !== sessionId || entry.isSidechain) continue
    const ts = str(entry.timestamp) || undefined
    if (entry.type === 'pr-link') {
      const number = Number(entry.prNumber)
      const url = str(entry.prUrl)
      if (number && url) pushMessage(out, 'system', [{ type: 'pr_link', number, url, repo: str(entry.prRepository) }], ts)
      continue
    }
    if (entry.type === 'frame-link') {
      const title = str(entry.title)
      const url = str(entry.frameUrl)
      const filePath = str(entry.path)
      if (!title && !url && !filePath) continue
      pushMessage(out, 'system', [{ type: 'artifact', title: title || 'Artifact', url: url || undefined, path: filePath || undefined }], ts)
      continue
    }
    if (entry.type === 'user') parseUser(entry, out, ts)
    else if (entry.type === 'assistant') {
      const parts = assistantParts(rec(entry.message)?.content)
      if (entry.isApiErrorMessage === true && parts.every((part) => part.type === 'text')) {
        const prev = out[out.length - 1]
        const text = parts[0] && parts[0].type === 'text' ? parts[0].text : ''
        const prevText = prev?.parts[0] && prev.parts[0].type === 'text' ? prev.parts[0].text : ''
        if (text && text === prevText) continue
      }
      pushMessage(out, 'assistant', parts, ts)
    }
  }
  return keepLastArtifact(dedupeConsecutiveText(attachToolResults(out)), limit)
}

function keepLastArtifact(all: TranscriptMessage[], limit: number): TranscriptMessage[] {
  const recent = all.slice(-Math.max(1, limit))
  if (recent.some((row) => row.parts.some((part) => part.type === 'artifact'))) return recent
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (all[index].parts.some((part) => part.type === 'artifact')) return [all[index], ...recent]
  }
  return recent
}

export function readClaudeTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const file = findClaudeTranscriptFile(sessionId)
  if (!file) return []
  return parseClaudeTranscriptLines(readJsonlTailLines(file, TRANSCRIPT_TAIL_BYTES), sessionId, limit)
}

function parseUser(entry: Record<string, unknown>, out: TranscriptMessage[], ts?: string) {
  const message = rec(entry.message)
  const raw = message?.content
  if (Array.isArray(raw) && raw.some((block) => rec(block)?.type === 'tool_result')) {
    const parts = raw.flatMap((block) => {
      const item = rec(block)
      if (!item || item.type !== 'tool_result') return []
      const content = typeof item.content === 'string'
        ? item.content
        : Array.isArray(item.content)
          ? item.content.map((part) => rec(part)?.text || '').join('\n')
          : ''
      const text = String(content).trim()
      return text ? [{ type: 'tool_result' as const, toolUseId: str(item.tool_use_id), content: text.slice(0, 12_000), isError: item.is_error === true }] : []
    })
    pushMessage(out, 'system', parts, ts)
    return
  }
  const content = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map((block) => str(rec(block)?.text)).join('\n')
      : ''
  if (isNoiseUserText(content)) return
  const part = textPart(content, 16_000)
  if (part) pushMessage(out, 'user', [part], ts)
}
