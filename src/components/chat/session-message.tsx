'use client'

import { useState } from 'react'
import {
  type MessageContentPart,
  type TranscriptMessage as SessionTranscriptMessage,
} from '@/lib/session-transcript-types'
import { renderSessionContent } from './session-message-format'

export type { SessionTranscriptMessage }

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
    <div className={`flex gap-0 border-l-2 ${config.borderClass} py-1.5 pl-3`}>
      <div className="hidden w-16 shrink-0 text-right sm:block">
        {showTimestamp && timeStr ? (
          <span className="font-mono-tight text-[10px] tabular-nums text-muted-foreground/50">{timeStr}</span>
        ) : null}
      </div>
      {config.indicator ? (
        <div className={`w-5 shrink-0 text-center font-mono-tight text-xs ${config.indicatorClass}`}>{config.indicator}</div>
      ) : <div className="w-5 shrink-0" />}
      <div className="min-w-0 flex-1 space-y-1">
        {message.parts.map((part, idx) => <PartRenderer key={idx} part={part} />)}
      </div>
    </div>
  )
}

function PartRenderer({ part }: { part: MessageContentPart }) {
  if (part.type === 'pr_link' || part.type === 'artifact') return null
  if (part.type === 'text') {
    return <div className="font-mono-tight wrap-break-word text-xs leading-relaxed whitespace-pre-wrap text-foreground">{renderSessionContent(part.text)}</div>
  }
  if (part.type === 'thinking') return <ThinkingPart thinking={part.thinking} />
  if (part.type === 'tool_use') {
    return (
      <div className="flex items-baseline gap-1.5 font-mono-tight text-[11px]">
        <span className="text-amber-400/80">{'\u2699'} {part.label || part.name}</span>
        <span className="truncate text-muted-foreground/40">{part.input.length > 80 ? `${part.input.slice(0, 80)}\u2026` : part.input}</span>
      </div>
    )
  }
  return <ToolResultPart content={part.content} isError={part.isError} />
}

function ThinkingPart({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-mono-tight text-[11px] text-muted-foreground/60 italic select-none hover:text-muted-foreground/80">
        {open ? '\u25BE' : '\u25B8'} thinking ({thinking.length} chars)
      </summary>
      <div className="mt-1 border-l border-muted-foreground/20 pl-3">
        <div className="font-mono-tight max-h-60 overflow-y-auto text-[11px] leading-relaxed text-muted-foreground/70 italic whitespace-pre-wrap wrap-break-word">{thinking}</div>
      </div>
    </details>
  )
}

function ToolResultPart({ content, isError }: { content: string; isError?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className={`cursor-pointer font-mono-tight text-[11px] select-none hover:brightness-125 ${isError ? 'text-red-400/70' : 'text-green-400/50'}`}>
        {'\u25B8'}{isError ? '\u2717' : '\u2713'} result ({content.length} chars)
      </summary>
      <div className="mt-1 max-h-40 overflow-y-auto rounded bg-black/20 px-3 py-1.5">
        <pre className="font-mono-tight wrap-break-word text-[11px] text-muted-foreground/70 whitespace-pre-wrap">{content}</pre>
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

export function shouldShowTimestamp(
  current: SessionTranscriptMessage,
  previous: SessionTranscriptMessage | undefined,
): boolean {
  if (!current.timestamp) return false
  if (!previous?.timestamp) return true
  return Math.abs(new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) > 30_000
}
