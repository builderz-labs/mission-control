'use client'

import { ChatMessage } from '@/store'

// Color mapping for agent roles/names
const AGENT_COLORS: Record<string, string> = {
  jarv: 'bg-purple-500',
  forge: 'bg-blue-500',
  aegis: 'bg-red-500',
  research: 'bg-green-500',
  design: 'bg-pink-500',
  quant: 'bg-yellow-500',
  ops: 'bg-orange-500',
  reviewer: 'bg-teal-500',
  content: 'bg-indigo-500',
  seo: 'bg-cyan-500',
  security: 'bg-rose-500',
  ai: 'bg-violet-500',
  'frontend-dev': 'bg-sky-500',
  'backend-dev': 'bg-emerald-500',
  'solana-dev': 'bg-amber-500',
  system: 'bg-gray-500',
  human: 'bg-primary',
}

function getAgentColor(name: string): string {
  return AGENT_COLORS[name.toLowerCase()] || 'bg-gray-500'
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface MessageBubbleProps {
  message: ChatMessage
  isHuman: boolean
}

export function MessageBubble({ message, isHuman }: MessageBubbleProps) {
  const isSystem = message.message_type === 'system'
  const isHandoff = message.message_type === 'handoff'
  const isCommand = message.message_type === 'command'

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="text-xs text-muted-foreground italic bg-secondary/50 px-3 py-1 rounded-full">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 mb-3 ${isHuman ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${getAgentColor(message.from_agent)}`}>
        {message.from_agent.charAt(0).toUpperCase()}
      </div>

      {/* Message content */}
      <div className={`max-w-[75%] ${isHuman ? 'items-end' : 'items-start'}`}>
        {/* Agent name */}
        <div className={`text-xs text-muted-foreground mb-0.5 ${isHuman ? 'text-right' : 'text-left'}`}>
          {message.from_agent}
          {message.to_agent && (
            <span className="text-muted-foreground/60"> → {message.to_agent}</span>
          )}
        </div>

        {/* Bubble */}
        <div className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isHuman
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : isHandoff
            ? 'bg-amber-500/10 border border-amber-500/30 text-foreground rounded-tl-sm'
            : isCommand
            ? 'bg-secondary font-mono text-xs text-foreground rounded-tl-sm'
            : 'bg-secondary text-foreground rounded-tl-sm'
        }`}>
          {isCommand ? (
            <pre className="whitespace-pre-wrap">{message.content}</pre>
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>

        {/* Timestamp */}
        <div className={`text-[10px] text-muted-foreground/50 mt-0.5 ${isHuman ? 'text-right' : 'text-left'}`}>
          {formatTime(message.created_at)}
        </div>
      </div>
    </div>
  )
}
