'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Streamdown } from 'streamdown'
import { useMemo, useRef, useState, useEffect } from 'react'
import { DmShell } from './shell'
import { DeckIcon } from './icons'

const MODEL_OPTIONS = [
  { id: 'auto', label: 'Auto · best available' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'gpt-4o', label: 'GPT-4o' },
]

const STARTERS = [
  'What happened overnight? Summarise audit log + approvals.',
  'Draft the morning brief from today\'s priorities.',
  'Explain the DarkMada memory spine in three bullets.',
  'What MCP services does Thinky call during a run?',
]

export function DarkMadaChat() {
  const [model, setModel] = useState('auto')
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/dm-chat', body: () => ({ model }) }),
    [model],
  )

  const { messages, sendMessage, status, stop, error } = useChat({ transport })
  const isLoading = status === 'submitted' || status === 'streaming'

  const [input, setInput] = useState('')
  const scrollerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll on new tokens
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, status])

  // Autosize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'
  }, [input])

  function submit() {
    const text = input.trim()
    if (!text || isLoading) return
    sendMessage({ text })
    setInput('')
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border/60">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="glass h-9 w-9 rounded-xl flex items-center justify-center text-foreground/85">
              <DeckIcon size={18} />
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-void-cyan">DarkMada · Chat</div>
              <div className="text-sm font-medium">New conversation</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="glass rounded-lg px-2.5 py-1.5 text-xs flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="bg-transparent outline-none text-foreground cursor-pointer"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-background">{m.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {messages.length === 0 ? (
            <EmptyState onPick={(s) => { setInput(s); setTimeout(() => textareaRef.current?.focus(), 0) }} />
          ) : (
            <div className="space-y-10">
              {messages.map((m, i) => (
                <Turn key={m.id} message={m} isStreaming={isLoading && i === messages.length - 1} />
              ))}
              {error && (
                <div className="glass border border-void-crimson/40 rounded-lg px-4 py-3 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-void-crimson mr-2">error</span>
                  {error.message}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/60">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <div className="glass-strong rounded-2xl border border-border/60 overflow-hidden focus-within:border-void-cyan/40 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask DarkMada anything… (⌘↵ to send, shift+↵ for newline)"
              rows={1}
              className="w-full resize-none bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground/60 leading-relaxed"
              disabled={isLoading}
            />
            <div className="flex items-center justify-between px-3 py-2 border-t border-border/40">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                <kbd className="px-1.5 py-0.5 rounded bg-muted/60 border border-border/40">⌘↵</kbd>
                <span>send</span>
              </div>
              <div className="flex items-center gap-2">
                {isLoading ? (
                  <button
                    onClick={stop}
                    className="text-xs rounded-md border border-void-crimson/40 bg-void-crimson/[0.06] text-void-crimson px-3 py-1.5 hover:bg-void-crimson/[0.12] transition"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={!input.trim()}
                    className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="py-16 space-y-10">
      <div className="text-center space-y-3">
        <div className="glass mx-auto h-14 w-14 rounded-2xl flex items-center justify-center text-foreground/85">
          <DeckIcon size={26} />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">How can I help, Jackson?</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Chat with DarkMada. Helmy drafts, Thinky routes, Velma researches — ask anything about the stack.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 max-w-2xl mx-auto">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="glass text-left rounded-xl px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-void-cyan/30 border border-border/50 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Turn({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const text = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')

  if (message.role === 'user') {
    return (
      <div className="group">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-1.5">you</div>
        <div className="text-foreground leading-relaxed whitespace-pre-wrap">{text}</div>
      </div>
    )
  }

  return (
    <div className="group">
      <div className="flex items-baseline gap-2 mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-void-cyan">darkmada</div>
        {isStreaming && (
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-void-cyan animate-pulse" />
        )}
      </div>
      <div className="prose prose-invert prose-sm max-w-none leading-relaxed text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:bg-card [&_pre]:border [&_pre]:border-border/60 [&_pre]:rounded-lg [&_code]:text-[0.92em] [&_:not(pre)>code]:bg-muted/60 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded">
        <Streamdown>{text}</Streamdown>
      </div>
    </div>
  )
}
