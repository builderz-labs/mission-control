'use client'

import { useRef, useEffect } from 'react'
import { useMissionControl, ChatMessage } from '@/store'
import { MessageBubble } from './message-bubble'

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

export function MessageList() {
  const { chatMessages, activeConversation } = useMissionControl()
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Only auto-scroll if user is near the bottom
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMessages])

  // Scroll to bottom on conversation change
  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [activeConversation])

  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-30">💬</div>
          <p className="text-sm">Select a conversation or start a new one</p>
        </div>
      </div>
    )
  }

  const conversationMessages = chatMessages.filter(
    m => m.conversation_id === activeConversation
  )

  if (conversationMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-3xl mb-2 opacity-30">✍️</div>
          <p className="text-sm">No messages yet. Say hello!</p>
        </div>
      </div>
    )
  }

  const groups = groupMessagesByDate(conversationMessages)

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3">
      {groups.map((group) => (
        <div key={group.date}>
          {/* Date separator */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">{group.date}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {group.messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isHuman={msg.from_agent === 'human' || msg.from_agent === 'nyk'}
            />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
