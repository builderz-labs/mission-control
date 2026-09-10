import { textPart, type MessageContentPart, type TranscriptMessage } from './session-transcript-types'

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  const description = str(input.description) || str(input.title) || str(input.summary)
  if (name === 'Agent' || name === 'Task') return description ? `Agent · ${description}` : 'Agent'
  if (name === 'Bash') return description || str(input.command).split('\n')[0] || 'Bash'
  if (name === 'Read') return `Read ${str(input.file_path) || str(input.path) || ''}`.trim()
  if (name === 'Grep') return `Searched ${str(input.pattern) || description || ''}`.trim()
  if (name === 'Artifact') return description || str(input.title) || 'Artifact'
  if (name.startsWith('mcp__')) return description || name.split('__').slice(-1)[0] || name
  return description || name
}

export function toolInputBody(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return str(input.command)
  if (name === 'Read') return str(input.file_path) || str(input.path)
  if (name === 'Agent' || name === 'Task') return str(input.prompt).slice(0, 4000)
  if (name === 'Artifact') return str(input.url) || str(input.path)
  const command = str(input.command)
  if (command) return command
  return JSON.stringify(input).slice(0, 2000)
}

export function assistantParts(raw: unknown): MessageContentPart[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((block) => {
    const item = rec(block)
    if (!item) return []
    if (item.type === 'thinking' && str(item.thinking).trim()) {
      return [{ type: 'thinking' as const, thinking: str(item.thinking).trim().slice(0, 8000) }]
    }
    if (item.type === 'text') {
      const part = textPart(str(item.text), 16_000)
      return part ? [part] : []
    }
    if (item.type === 'tool_use') {
      const input = rec(item.input) || {}
      const name = str(item.name) || 'tool'
      return [{
        type: 'tool_use' as const,
        id: str(item.id),
        name,
        label: toolLabel(name, input),
        input: toolInputBody(name, input),
      }]
    }
    return []
  })
}

export function attachToolResults(messages: TranscriptMessage[]): TranscriptMessage[] {
  const byId = new Map<string, Extract<MessageContentPart, { type: 'tool_use' }>>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_use' && part.id) byId.set(part.id, part)
    }
  }
  return messages.filter((message) => {
    if (message.role !== 'system' || !message.parts.every((part) => part.type === 'tool_result')) return true
    let attached = 0
    for (const part of message.parts) {
      if (part.type !== 'tool_result') continue
      const tool = byId.get(part.toolUseId)
      if (!tool) continue
      tool.result = part.content
      tool.isError = part.isError
      attached += 1
    }
    return attached !== message.parts.length
  })
}

export function dedupeConsecutiveText(messages: TranscriptMessage[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = []
  for (const message of messages) {
    const prev = out[out.length - 1]
    const text = message.parts.length === 1 && message.parts[0].type === 'text' ? message.parts[0].text : null
    const prevText = prev && prev.role === message.role && prev.parts.length === 1 && prev.parts[0].type === 'text'
      ? prev.parts[0].text
      : null
    if (text && prevText && text === prevText) continue
    out.push(message)
  }
  return out
}
