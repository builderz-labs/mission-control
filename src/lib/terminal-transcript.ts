import type { MessageContentPart, TranscriptMessage } from './session-transcript-types'
import { isNoiseUserText } from './session-transcript-types'

/**
 * Flattens a session transcript into terminal scrollback lines so the dashboard
 * can render a CLI session the way an integrated terminal shows a shell: a
 * prompt for each thing the operator typed, the command the agent ran, and the
 * output it produced.
 */
export type TerminalLineKind =
  | 'prompt'
  | 'output'
  | 'command'
  | 'result'
  | 'error'
  | 'thinking'
  | 'meta'

export interface TerminalLine {
  id: string
  kind: TerminalLineKind
  text: string
}

const MAX_RESULT_LINES = 12
const MAX_LINE_CHARS = 400
const MAX_ARG_CHARS = 120

function normalize(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    // Strip ANSI SGR sequences: colour is applied from the line kind instead.
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line))
}

function push(lines: TerminalLine[], kind: TerminalLineKind, text: string, prefix = ''): void {
  for (const line of normalize(text)) {
    lines.push({ id: `l${lines.length}`, kind, text: prefix ? `${prefix}${line}` : line })
  }
}

function pushClamped(lines: TerminalLine[], kind: TerminalLineKind, text: string): void {
  const all = normalize(text).filter((line, index, list) => line.trim() || index < list.length - 1)
  const shown = all.slice(0, MAX_RESULT_LINES)
  for (const line of shown) {
    lines.push({ id: `l${lines.length}`, kind, text: `  ${line}` })
  }
  if (all.length > shown.length) {
    lines.push({
      id: `l${lines.length}`,
      kind: 'meta',
      text: `  … ${all.length - shown.length} more line${all.length - shown.length === 1 ? '' : 's'}`,
    })
  }
}

/** Renders tool input as a single-line argument string, the way a shell echoes one. */
export function commandArguments(input: string): string {
  const flat = String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat || flat === '{}') return ''
  const unwrapped = flat.startsWith('{') && flat.endsWith('}') ? flat.slice(1, -1).trim() : flat
  if (!unwrapped) return ''
  return unwrapped.length > MAX_ARG_CHARS ? `${unwrapped.slice(0, MAX_ARG_CHARS)}…` : unwrapped
}

function appendPart(lines: TerminalLine[], role: TranscriptMessage['role'], part: MessageContentPart): void {
  switch (part.type) {
    case 'text': {
      if (role === 'user') {
        if (isNoiseUserText(part.text)) return
        push(lines, 'prompt', part.text, '❯ ')
        return
      }
      push(lines, role === 'system' ? 'meta' : 'output', part.text)
      return
    }
    case 'thinking':
      push(lines, 'thinking', part.thinking, '· ')
      return
    case 'tool_use': {
      const args = commandArguments(part.input)
      push(lines, 'command', `${part.label || part.name}${args ? ` ${args}` : ''}`, '$ ')
      if (part.result) pushClamped(lines, part.isError ? 'error' : 'result', part.result)
      return
    }
    case 'tool_result':
      pushClamped(lines, part.isError ? 'error' : 'result', part.content)
      return
    case 'pr_link':
      push(lines, 'meta', `${part.repo}#${part.number} ${part.url}`)
      return
    case 'artifact':
      push(lines, 'meta', `artifact: ${part.title}${part.path ? ` (${part.path})` : ''}`)
  }
}

export function transcriptToTerminalLines(messages: TranscriptMessage[]): TerminalLine[] {
  const lines: TerminalLine[] = []
  for (const message of messages) {
    const before = lines.length
    for (const part of message.parts) appendPart(lines, message.role, part)
    // Blank separator between turns, so prompts stay legible in a dense buffer.
    if (lines.length > before && message.role === 'assistant') {
      lines.push({ id: `l${lines.length}`, kind: 'output', text: '' })
    }
  }
  while (lines.length > 0 && !lines[lines.length - 1].text) lines.pop()
  return lines
}

/** Trailing shell prompt: solid when the agent is idle, animated while it works. */
export function terminalCursorLabel(working: boolean, active: boolean): string {
  if (working) return '❯ running…'
  return active ? '❯ ' : '❯ (session idle)'
}
