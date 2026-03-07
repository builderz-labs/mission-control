'use client'

import { useState } from 'react'

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export type SessionTranscriptMessage = {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
}

interface SessionMessageProps {
  message: SessionTranscriptMessage
  showTimestamp: boolean
}

const ROLE_CONFIG = {
  user: { indicator: '$', indicatorClass: 'text-green-400', borderClass: 'border-l-green-500/40' },
  assistant: { indicator: '\u25C6', indicatorClass: 'text-primary', borderClass: 'border-l-primary/40' },
  system: { indicator: '', indicatorClass: '', borderClass: 'border-l-amber-500/20' },
} as const

export function SessionMessage({ message, showTimestamp }: SessionMessageProps) {
  const config = ROLE_CONFIG[message.role]
  const timeStr = message.timestamp ? formatTime(message.timestamp) : ''

  return (
    <div className={`flex gap-0 border-l-2 ${config.borderClass} pl-3 py-1.5`}>
      {/* Timestamp gutter */}
      <div className="hidden w-16 flex-shrink-0 text-right sm:block">
        {showTimestamp && timeStr && (
          <span className="font-mono-tight text-[10px] tabular-nums text-muted-foreground/50">
            {timeStr}
          </span>
        )}
      </div>

      {/* Indicator */}
      {config.indicator && (
        <div className={`w-5 flex-shrink-0 text-center font-mono-tight text-xs ${config.indicatorClass}`}>
          {config.indicator}
        </div>
      )}
      {!config.indicator && <div className="w-5 flex-shrink-0" />}

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        {message.parts.map((part, idx) => (
          <PartRenderer key={idx} part={part} />
        ))}
      </div>
    </div>
  )
}

function PartRenderer({ part }: { part: MessageContentPart }) {
  switch (part.type) {
    case 'text':
      return <TextPart text={part.text} />
    case 'thinking':
      return <ThinkingPart thinking={part.thinking} />
    case 'tool_use':
      return <ToolUsePart name={part.name} input={part.input} />
    case 'tool_result':
      return <ToolResultPart content={part.content} isError={part.isError} />
    default:
      return null
  }
}

function TextPart({ text }: { text: string }) {
  return (
    <div className="font-mono-tight text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">
      {renderSessionContent(text)}
    </div>
  )
}

function ThinkingPart({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none font-mono-tight text-[11px] text-muted-foreground/60 italic hover:text-muted-foreground/80">
        {open ? '\u25BE' : '\u25B8'} thinking ({thinking.length} chars)
      </summary>
      <div className="mt-1 border-l border-muted-foreground/20 pl-3">
        <div className="font-mono-tight text-[11px] italic leading-relaxed text-muted-foreground/70 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {thinking}
        </div>
      </div>
    </details>
  )
}

function ToolUsePart({ name, input }: { name: string; input: string }) {
  return (
    <div className="flex items-baseline gap-1.5 font-mono-tight text-[11px]">
      <span className="text-amber-400/80">{'\u2699'} {name}</span>
      <span className="truncate text-muted-foreground/40">{input.length > 80 ? input.slice(0, 80) + '\u2026' : input}</span>
    </div>
  )
}

function ToolResultPart({ content, isError }: { content: string; isError?: boolean }) {
  const [open, setOpen] = useState(false)
  const icon = isError ? '\u2717' : '\u2713'
  const colorClass = isError ? 'text-red-400/70' : 'text-green-400/50'
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={`cursor-pointer select-none font-mono-tight text-[11px] ${colorClass} hover:brightness-125`}>
        {icon} {isError ? 'error' : 'result'} ({content.length} chars)
      </summary>
      <div className="mt-1 max-h-40 overflow-y-auto rounded bg-black/20 p-2">
        <pre className="font-mono-tight text-[11px] text-muted-foreground/70 whitespace-pre-wrap break-words">
          {content}
        </pre>
      </div>
    </details>
  )
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Should timestamps be shown? Only when gap > 30s from previous. */
export function shouldShowTimestamp(
  current: SessionTranscriptMessage,
  previous: SessionTranscriptMessage | undefined,
): boolean {
  if (!current.timestamp) return false
  if (!previous?.timestamp) return true
  const gap = new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()
  return Math.abs(gap) > 30000
}

// --- Enhanced content renderer ---

function renderSessionContent(text: string): React.ReactNode[] {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g)

  return parts.map((part, i) => {
    // Multi-line code block
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3)
      const newlineIdx = inner.indexOf('\n')
      const lang = newlineIdx > 0 ? inner.slice(0, newlineIdx).trim() : ''
      const code = newlineIdx > 0 ? inner.slice(newlineIdx + 1) : inner
      return (
        <div key={i} className="my-1.5 rounded border border-border/30 overflow-hidden">
          {lang && (
            <div className="bg-black/30 px-2 py-0.5 text-[10px] text-muted-foreground/50 border-b border-border/20">
              {lang}
            </div>
          )}
          <pre className="bg-black/20 px-3 py-2 text-[11px] overflow-x-auto whitespace-pre">
            {code}
          </pre>
        </div>
      )
    }
    // Inline code
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-black/20 rounded px-1 py-0.5 text-[11px]">
          {part.slice(1, -1)}
        </code>
      )
    }
    // Regular text with formatting
    return <span key={i}>{renderInlineFormatting(part)}</span>
  })
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  // Process line by line to handle headers, lists, and inline formatting
  const lines = text.split('\n')
  const result: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) result.push('\n')
    const line = lines[i]

    // Headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headerMatch) {
      const level = headerMatch[1].length
      const headerClass = level === 1 ? 'text-sm font-bold' : level === 2 ? 'text-xs font-semibold' : 'text-xs font-medium'
      result.push(<span key={`h-${i}`} className={`${headerClass} text-foreground`}>{renderInlineText(headerMatch[2])}</span>)
      continue
    }

    // List items
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)/)
    if (listMatch) {
      const indent = listMatch[1].length
      const bullet = listMatch[2].match(/\d/) ? listMatch[2] : '\u2022'
      result.push(
        <span key={`li-${i}`} style={{ paddingLeft: `${indent * 4 + 4}px` }}>
          <span className="text-muted-foreground/50">{bullet}</span> {renderInlineText(listMatch[3])}
        </span>
      )
      continue
    }

    result.push(<span key={`l-${i}`}>{renderInlineText(line)}</span>)
  }

  return result
}

function renderInlineText(text: string): React.ReactNode[] {
  // Bold, italic, links
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((segment, j) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return <strong key={j} className="font-semibold text-foreground">{segment.slice(2, -2)}</strong>
    }
    if (segment.startsWith('*') && segment.endsWith('*') && !segment.startsWith('**')) {
      return <em key={j}>{segment.slice(1, -1)}</em>
    }
    const linkMatch = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return (
        <a key={j} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
          className="text-primary/80 underline decoration-primary/30 hover:decoration-primary/60">
          {linkMatch[1]}
        </a>
      )
    }
    return segment
  })
}
