export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string; label?: string; result?: string; isError?: boolean }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'pr_link'; number: number; url: string; repo: string }
  | { type: 'artifact'; title: string; url?: string; path?: string }

export type TranscriptMessage = {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
}

export function textPart(content: string | null | undefined, limit = 8000): MessageContentPart | null {
  const text = String(content || '').trim()
  if (!text) return null
  return { type: 'text', text: text.slice(0, limit) }
}

export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const rec = block as Record<string, unknown>
      return typeof rec.text === 'string' ? rec.text : ''
    })
    .join('\n')
    .trim()
}

export function pushMessage(
  list: TranscriptMessage[],
  role: TranscriptMessage['role'],
  parts: MessageContentPart[],
  timestamp?: string,
) {
  if (parts.length === 0) return
  list.push({ role, parts, timestamp })
}

export function isNoiseUserText(text: string): boolean {
  const trimmed = text.trim()
  return /^(<system-reminder>|<notification|<task-notification)/.test(trimmed)
}

export function isAgentWorking(
  messages: TranscriptMessage[],
  flags: { active?: boolean; busy?: boolean } = {},
): boolean {
  if (flags.active || flags.busy) return true
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return false
  return last.parts.some((part) => {
    if (part.type === 'thinking') return true
    return part.type === 'tool_use' && !part.result
  })
}
