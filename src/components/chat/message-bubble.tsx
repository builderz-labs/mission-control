'use client'

import { ChatMessage } from '@/store'

const AGENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  coordinator: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  aegis: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  research: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  design: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20' },
  quant: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  ops: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  reviewer: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20' },
  content: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  seo: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  security: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
  ai: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  'frontend-dev': { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/20' },
  'backend-dev': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  'solana-dev': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  system: { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-border' },
  human: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' },
}

function getAgentTheme(name: string) {
  return AGENT_COLORS[name.toLowerCase()] || { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-border' }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Simple markdown-lite: bold, italic, code, links
function renderContent(text: string) {
  // Split by code blocks first
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g)

  return parts.map((part, i) => {
    // Multi-line code block
    if (part.startsWith('```') && part.endsWith('```')) {
      const code = part.slice(3, -3).replace(/^\w+\n/, '') // strip language hint
      return (
        <pre key={i} className="bg-black/30 rounded-md px-3 py-2 my-1 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
          {code}
        </pre>
      )
    }
    // Inline code
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-black/20 rounded px-1 py-0.5 text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      )
    }
    // Regular text with bold/italic
    return (
      <span key={i}>
        {part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((segment, j) => {
          if (segment.startsWith('**') && segment.endsWith('**')) {
            return <strong key={j} className="font-semibold">{segment.slice(2, -2)}</strong>
          }
          if (segment.startsWith('*') && segment.endsWith('*')) {
            return <em key={j}>{segment.slice(1, -1)}</em>
          }
          return segment
        })}
      </span>
    )
  })
}

interface MessageBubbleProps {
  message: ChatMessage
  isHuman: boolean
  isGrouped: boolean
}

export function MessageBubble({ message, isHuman, isGrouped }: MessageBubbleProps) {
  const isSystem = message.message_type === 'system'
  const isHandoff = message.message_type === 'handoff'
  const isCommand = message.message_type === 'command'
  const theme = getAgentTheme(message.from_agent)

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <div className="text-[11px] text-muted-foreground/70 bg-surface-1 px-3 py-1 rounded-full border border-border/30">
          {message.content}
        </div>
      </div>
    )
  }

  if (isHandoff) {
    return (
      <div className="flex justify-center my-3">
        <div className="flex items-center gap-2 text-[11px] text-amber-400/80 bg-amber-500/5 px-3 py-1.5 rounded-full border border-amber-500/20">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M5 3l6 5-6 5" />
          </svg>
          <span>{message.from_agent} handed off to {message.to_agent}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 ${isHuman ? 'flex-row-reverse' : 'flex-row'} ${isGrouped ? 'mt-0.5' : 'mt-3'}`}>
      {/* Avatar */}
      {!isGrouped ? (
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${theme.bg} ${theme.text} border ${theme.border}`}>
          {message.from_agent.charAt(0).toUpperCase()}
        </div>
      ) : (
        <div className="w-7 flex-shrink-0" />
      )}

      {/* Content */}
      <div className={`max-w-[80%] min-w-0 ${isHuman ? 'items-end' : 'items-start'}`}>
        {/* Name + recipient */}
        {!isGrouped && (
          <div className={`flex items-center gap-1.5 mb-0.5 ${isHuman ? 'flex-row-reverse' : 'flex-row'}`}>
            <span className={`text-[11px] font-medium ${theme.text}`}>
              {message.from_agent}
            </span>
            {message.to_agent && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 3l6 5-6 5" />
                </svg>
                {message.to_agent}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/40">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        {/* Bubble */}
        <div className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isHuman
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : isCommand
            ? `${theme.bg} border ${theme.border} font-mono text-xs rounded-tl-sm`
            : `bg-surface-2 text-foreground ${isGrouped ? 'rounded-tl-sm' : 'rounded-tl-sm'}`
        }`}>
          {isCommand ? (
            <pre className="whitespace-pre-wrap">{message.content}</pre>
          ) : (
            <div className="whitespace-pre-wrap break-words">{renderContent(message.content)}</div>
          )}
        </div>
      </div>
    </div>
  )
}
