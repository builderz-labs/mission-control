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

    // Check for @ mentions
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
    <div className="relative border-t border-border bg-card p-3">
      {/* Mention autocomplete dropdown */}
      {showMentions && filteredAgents.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-40 overflow-y-auto z-10">
          {filteredAgents.map((agent, i) => (
            <button
              key={agent.name}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                i === mentionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(agent.name)
              }}
            >
              <span className="font-medium text-foreground">@{agent.name}</span>
              <span className="text-muted-foreground text-xs">{agent.role}</span>
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
          placeholder={disabled ? 'Select a conversation...' : 'Type a message... (@ to mention)'}
          disabled={disabled || isSendingMessage}
          rows={1}
          className="flex-1 resize-none bg-secondary rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!chatInput.trim() || disabled || isSendingMessage}
          className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {isSendingMessage ? (
            <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            'Send'
          )}
        </button>
      </div>
    </div>
  )
}
