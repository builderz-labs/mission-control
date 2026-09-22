'use client'

import { MarkdownRenderer } from '@/components/markdown-renderer'
import type { SessionTranscriptMessage } from '../session-message'
import { SessionPrChip } from './session-pr-chip'
import { SessionToolRow } from './session-tool-row'

export function SessionThread({
  messages,
  live = false,
}: {
  messages: SessionTranscriptMessage[]
  live?: boolean
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-8 py-6">
      {messages.map((message, index) => (
        <article key={`${message.timestamp || 'row'}-${index}`} className="text-[15px] leading-[1.65] text-[var(--chat-text)]">
          {message.parts.map((part, partIndex) => {
            if (part.type === 'text') {
              return (
                <div key={partIndex} className="chat-plan-prose">
                  <MarkdownRenderer content={part.text} />
                </div>
              )
            }
            if (part.type === 'thinking') {
              return <SessionToolRow key={partIndex} label="Thinking">{part.thinking}</SessionToolRow>
            }
            if (part.type === 'tool_use') {
              const body = [part.input, part.result].filter(Boolean).join('\n\n')
              return (
                <SessionToolRow
                  key={partIndex}
                  label={part.label || part.name}
                  detail={part.isError ? 'failed' : undefined}
                >
                  {body}
                </SessionToolRow>
              )
            }
            if (part.type === 'pr_link') {
              return (
                <div key={partIndex} className="py-1">
                  <SessionPrChip number={part.number} repo={part.repo} href={part.url} />
                </div>
              )
            }
            if (part.type === 'artifact') {
              return (
                <p key={partIndex} className="text-[13px] text-[var(--chat-muted)]">
                  Artifact · {part.title}
                </p>
              )
            }
            if (part.type === 'tool_result') {
              return (
                <SessionToolRow key={partIndex} label={part.isError ? 'Error' : 'Result'} detail={`${part.content.length} chars`}>
                  {part.content}
                </SessionToolRow>
              )
            }
            return null
          })}
        </article>
      ))}
      {live ? (
        <div className="chat-glimmer-line h-px w-full overflow-hidden bg-white/10" aria-hidden />
      ) : null}
    </div>
  )
}
