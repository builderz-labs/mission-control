'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { useMissionControl } from '@/store'

interface ChatInputProps {
  onSend: (content: string) => void
  disabled?: boolean
  agents?: Array<{ name: string; role: string }>
}

export function ChatInput({ onSend, disabled, agents = [] }: ChatInputProps) {
  const { chatInput, setChatInput, isSendingMessage } = useMissionControl()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(mentionFilter.toLowerCase())
  )

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [])

  useEffect(() => {
    autoResize()
  }, [chatInput, autoResize])

  // Focus textarea when panel opens
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus()
    }
  }, [disabled])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => Math.min(i + 1, filteredAgents.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filteredAgents[mentionIndex]) {
          insertMention(filteredAgents[mentionIndex].name)
        }
        return
      }
      if (e.key === 'Escape') {
        setShowMentions(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setChatInput(value)

    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@(\w*)$/)

    if (atMatch) {
      setMentionFilter(atMatch[1])
      setShowMentions(true)
      setMentionIndex(0)
    } else {
      setShowMentions(false)
    }
  }

  const insertMention = (agentName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = chatInput.slice(0, cursorPos)
    const textAfterCursor = chatInput.slice(cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')

    const newText = textBeforeCursor.slice(0, atIndex) + `@${agentName} ` + textAfterCursor
    setChatInput(newText)
    setShowMentions(false)

    setTimeout(() => {
      const newPos = atIndex + agentName.length + 2
      textarea.setSelectionRange(newPos, newPos)
      textarea.focus()
    }, 0)
  }

  const handleSend = () => {
    const trimmed = chatInput.trim()
    if (!trimmed || disabled || isSendingMessage) return
    onSend(trimmed)
    setChatInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  return (
    <div className="relative border-t border-border bg-card/80 backdrop-blur-sm p-3 flex-shrink-0 safe-area-bottom">
      {/* Mention autocomplete dropdown */}
      {showMentions && filteredAgents.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-popover/95 backdrop-blur-lg border border-border rounded-lg shadow-xl overflow-hidden max-h-40 overflow-y-auto z-10">
          {filteredAgents.map((agent, i) => (
            <button
              key={agent.name}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                i === mentionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(agent.name)
              }}
            >
              <div className="w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium text-foreground">@{agent.name}</span>
              <span className="text-muted-foreground text-xs ml-auto">{agent.role}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={chatInput}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Select a conversation...' : 'Message... (@ to mention, Enter to send)'}
          disabled={disabled || isSendingMessage}
          rows={1}
          className="flex-1 resize-none bg-surface-1 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40 transition-all"
        />
        <button
          onClick={handleSend}
          disabled={!chatInput.trim() || disabled || isSendingMessage}
          className="w-8 h-8 flex items-center justify-center bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-smooth flex-shrink-0"
          title="Send message"
        >
          {isSendingMessage ? (
            <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2L7 9" />
              <path d="M14 2l-5 12-2-5-5-2 12-5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
