import { clipExcerpt } from './session-handoff'
import { extractSessionArtifacts } from './session-artifacts'
import { filesTouched, redactSecrets } from './handoff-redact'
import type { TranscriptMessage } from './session-transcript-types'

export const HANDOFF_BRIEF_MAX = 16_000

function textOf(messages: TranscriptMessage[], role: TranscriptMessage['role'], take: number): string {
  const chunks: string[] = []
  for (let index = messages.length - 1; index >= 0 && chunks.length < take; index -= 1) {
    const message = messages[index]
    if (message.role !== role) continue
    const text = message.parts.filter((part) => part.type === 'text').map((part) => part.type === 'text' ? part.text : '').join('\n').trim()
    if (text) chunks.push(text)
  }
  return chunks.reverse().join('\n\n')
}

function toolsOf(messages: TranscriptMessage[], take = 20): string {
  const rows: string[] = []
  for (let index = messages.length - 1; index >= 0 && rows.length < take; index -= 1) {
    for (const part of messages[index].parts) {
      if (part.type !== 'tool_use') continue
      const result = part.result ? `\n  result: ${clipExcerpt(redactSecrets(part.result), 400)}` : ''
      rows.push(`- ${part.label || part.name}: ${clipExcerpt(redactSecrets(part.input), 240)}${result}`)
      if (rows.length >= take) break
    }
  }
  return rows.reverse().join('\n')
}

function prsOf(messages: TranscriptMessage[]): string {
  const rows = messages.flatMap((message) => message.parts.flatMap((part) => {
    if (part.type !== 'pr_link') return []
    return [`- #${part.number} ${part.repo} ${part.url}`]
  }))
  return [...new Set(rows)].join('\n')
}

export function buildHandoffBrief(input: {
  title: string
  sourceKind: string
  sourceId: string
  project: string
  messages: TranscriptMessage[]
  excerpt?: string
  note?: string
  git?: string
  sourceAgent?: string
  targetAgent?: string
  window?: number
}): string {
  const artifacts = extractSessionArtifacts(input.messages)
    .map((item) => `- ${item.title}${item.url ? ` ${item.url}` : ''}${item.path ? ` (${item.path})` : ''}`)
    .join('\n')
  const lastAssistant = textOf(input.messages, 'assistant', 3)
  const lastUser = textOf(input.messages, 'user', 3)
  const tools = toolsOf(input.messages)
  const prs = prsOf(input.messages)
  const files = filesTouched(`${tools}\n${lastAssistant}\n${lastUser}`).map((file) => `- ${file}`).join('\n')
  const parts = [
    'Handoff: continue this work without losing context. You are picking up another engine\'s session.',
    `Title: ${clipExcerpt(input.title, 200)}`,
    `Source engine: ${input.sourceKind}`,
    `Source session: ${input.sourceId}`,
    `Project: ${clipExcerpt(input.project, 400)}`,
  ]
  if (input.sourceAgent) parts.push(`Source agent: ${input.sourceAgent}`)
  if (input.targetAgent) parts.push(`Target agent: ${input.targetAgent}`)
  if (input.window) parts.push(`Shared context window: ${input.window}`)
  if (prs) parts.push(`Pull requests:\n${prs}`)
  if (artifacts) parts.push(`Artifacts:\n${artifacts}`)
  if (files) parts.push(`Files touched:\n${files}`)
  if (input.git?.trim()) parts.push(`Git:\n${clipExcerpt(input.git, 400)}`)
  if (tools) parts.push(`Recent tools:\n${tools}`)
  if (lastUser) parts.push(`Recent user messages:\n${clipExcerpt(redactSecrets(lastUser), 3000)}`)
  if (lastAssistant) parts.push(`Recent assistant messages:\n${clipExcerpt(redactSecrets(lastAssistant), 5000)}`)
  if (input.excerpt) parts.push(`Client excerpt:\n${clipExcerpt(input.excerpt, 2000)}`)
  if (input.note?.trim()) parts.push(`Operator note: ${clipExcerpt(input.note, 500)}`)
  parts.push('Continue from this context. Preserve decisions, constraints, file paths, and next steps. Do not restart the work.')
  return clipExcerpt(parts.join('\n\n'), HANDOFF_BRIEF_MAX)
}
