'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { useMissionControl, ChatMessage } from '@/store'
import { apiFetch } from '@/lib/api-client'
import { MessageBubble } from './message-bubble'
import { Button } from '@/components/ui/button'

function formatDateGroup(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupMessagesByDate(messages: ChatMessage[]): Array<{ date: string; messages: ChatMessage[] }> {
  const groups: Array<{ date: string; messages: ChatMessage[] }> = []
  let currentDate = ''

  for (const msg of messages) {
    const dateStr = formatDateGroup(msg.created_at)
    if (dateStr !== currentDate) {
      currentDate = dateStr
      groups.push({ date: dateStr, messages: [] })
    }
    groups[groups.length - 1].messages.push(msg)
  }

  return groups
}

// Check if message should be visually grouped with previous
function isGroupedWithPrevious(messages: ChatMessage[], index: number): boolean {
  if (index === 0) return false
  const prev = messages[index - 1]
  const curr = messages[index]
  // Same sender, within 2 minutes, not a system message
  return (
    prev.from_agent === curr.from_agent &&
    curr.created_at - prev.created_at < 120 &&
    prev.message_type !== 'system' &&
    curr.message_type !== 'system'
  )
}

export function MessageList() {
  const { chatMessages, activeConversation, isSendingMessage, updatePendingMessage, removePendingMessage, addChatMessage } = useMissionControl()
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showNewMessages, setShowNewMessages] = useState(false)
  const prevMessageCountRef = useRef(0)

  const isNearBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return true
    return container.scrollHeight - container.scrollTop - container.clientHeight < 120
  }, [])

  // Auto-scroll to bottom on new messages (only if near bottom)
  useEffect(() => {
    const conversationMessages = chatMessages.filter(m => m.conversation_id === activeConversation)
    const newCount = conversationMessages.length

    if (newCount > prevMessageCountRef.current) {
      if (isNearBottom()) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      } else {
        setShowNewMessages(true)
      }
    }
    prevMessageCountRef.current = newCount
  }, [chatMessages, activeConversation, isNearBottom])

  // Scroll to bottom on conversation change
  useEffect(() => {
    bottomRef.current?.scrollIntoView()
    setShowNewMessages(false)
    prevMessageCountRef.current = 0
  }, [activeConversation])

  // Track scroll position to hide "new messages" indicator
  const handleScroll = useCallback(() => {
    if (isNearBottom()) {
      setShowNewMessages(false)
    }
  }, [isNearBottom])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowNewMessages(false)
  }, [])

  // Retry a failed message
  const handleRetry = async (msg: ChatMessage) => {
    updatePendingMessage(msg.id, { pendingStatus: 'sending' })

    try {
      // apiFetch throws on non-2xx and network failure; the original code
      // marked the message failed in both the non-ok branch and the catch,
      // so a single catch below reproduces that graceful degradation.
      const data = await apiFetch<{ message?: ChatMessage }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          from: msg.from_agent,
          to: msg.to_agent,
          content: msg.content,
          conversation_id: msg.conversation_id,
          message_type: msg.message_type,
          forward: true,
        }),
      })

      if (data.message) {
        // Remove temp message and add real one
        removePendingMessage(msg.id)
        addChatMessage(data.message)
      }
    } catch {
      updatePendingMessage(msg.id, { pendingStatus: 'failed' })
    }
  }

  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-12 h-12 rounded-lg bg-surface-2 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
              <path d="M14 10c0 .37-.1.7-.28 1-.53.87-2.2 3-5.72 3-4.42 0-6-3-6-4V4a2 2 0 012-2h8a2 2 0 012 2v6z" />
              <path d="M6 7h.01M10 7h.01" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">Select a conversation</p>
          <p className="text-xs text-muted-foreground/50 mt-1">or start a new one with an agent</p>
        </div>
      </div>
    )
  }

  const conversationMessages = chatMessages.filter(
    m => m.conversation_id === activeConversation
  )

  if (conversationMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-12 h-12 rounded-lg bg-surface-2 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
              <path d="M12 3H4a1 1 0 00-1 1v6l3-2h6a1 1 0 001-1V4a1 1 0 00-1-1z" />
              <path d="M7 11v1a1 1 0 001 1h5l2 2v-6a1 1 0 00-1-1h-1" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">No messages yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Send a message to get started</p>
        </div>
      </div>
    )
  }

  const groups = groupMessagesByDate(conversationMessages)

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto px-4 py-3" onScroll={handleScroll}>
      {groups.map((group) => (
        <div key={group.date}>
          {/* Date separator */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border/50" />
            <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">{group.date}</span>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {group.messages.map((msg, idx) => (
            <div key={msg.id} className={msg.pendingStatus === 'sending' ? 'opacity-60' : ''}>
              {/* Failed message wrapper */}
              {msg.pendingStatus === 'failed' && (
                <div className="border border-red-500/30 rounded-lg p-0.5 mb-1">
                  <MessageBubble
                    message={msg}
                    isHuman={msg.from_agent === 'human'}
                    isGrouped={isGroupedWithPrevious(group.messages, idx)}
                  />
                  <div className="flex items-center gap-2 px-3 pb-2">
                    <span className="text-[10px] text-red-400">Failed to send</span>
                    <Button
                      onClick={() => handleRetry(msg)}
                      variant="link"
                      className="text-[10px] text-primary h-auto p-0"
                    >
                      Retry
                    </Button>
                    <Button
                      onClick={() => removePendingMessage(msg.id)}
                      variant="ghost"
                      className="text-[10px] text-muted-foreground h-auto p-0"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {/* Normal or sending message */}
              {msg.pendingStatus !== 'failed' && (
                <MessageBubble
                  message={msg}
                  isHuman={msg.from_agent === 'human'}
                  isGrouped={isGroupedWithPrevious(group.messages, idx)}
                />
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Typing indicator */}
      {isSendingMessage && (
        <div className="flex gap-2 mt-3">
          <div className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center shrink-0">
            <div className="flex gap-0.5">
              <div className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
          <div className="bg-surface-2 rounded-lg rounded-tl-sm px-3 py-2">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />

      {/* New messages indicator */}
      {showNewMessages && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-3 left-1/2 -translate-x-1/2 z-10 bg-primary text-primary-foreground px-4 py-1.5 rounded-full text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5"
        >
          New messages
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  )
}
