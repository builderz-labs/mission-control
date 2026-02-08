'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl, Conversation, Agent } from '@/store'

function timeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

interface ConversationListProps {
  onNewConversation: (agentName: string) => void
}

export function ConversationList({ onNewConversation }: ConversationListProps) {
  const {
    conversations,
    setConversations,
    activeConversation,
    setActiveConversation,
    agents,
    markConversationRead,
  } = useMissionControl()
  const [showNewChat, setShowNewChat] = useState(false)
  const [search, setSearch] = useState('')

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations')
      if (!res.ok) return
      const data = await res.json()
      if (data.conversations) {
        setConversations(
          data.conversations.map((c: any) => ({
            id: c.conversation_id,
            participants: [],
            lastMessage: c.last_message
              ? {
                  id: c.last_message.id,
                  conversation_id: c.last_message.conversation_id,
                  from_agent: c.last_message.from_agent,
                  to_agent: c.last_message.to_agent,
                  content: c.last_message.content,
                  message_type: c.last_message.message_type,
                  metadata: c.last_message.metadata,
                  read_at: c.last_message.read_at,
                  created_at: c.last_message.created_at,
                }
              : undefined,
            unreadCount: c.unread_count || 0,
            updatedAt: c.last_message_at || 0,
          }))
        )
      }
    } catch (err) {
      console.error('Failed to load conversations:', err)
    }
  }, [setConversations])

  useEffect(() => {
    loadConversations()
    const interval = setInterval(loadConversations, 5000)
    return () => clearInterval(interval)
  }, [loadConversations])

  const handleSelect = (convId: string) => {
    setActiveConversation(convId)
    markConversationRead(convId)
  }

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      c.id.toLowerCase().includes(s) ||
      c.lastMessage?.from_agent.toLowerCase().includes(s) ||
      c.lastMessage?.content.toLowerCase().includes(s)
    )
  })

  const statusColor = (status: string) => {
    switch (status) {
      case 'busy': return 'bg-green-500'
      case 'idle': return 'bg-yellow-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  return (
    <div className="w-60 border-r border-border flex flex-col bg-card">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Conversations</h3>
          <button
            onClick={() => setShowNewChat(!showNewChat)}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-lg"
            title="New conversation"
          >
            +
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-secondary rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* New chat agent picker */}
      {showNewChat && (
        <div className="border-b border-border p-2 bg-secondary/50 max-h-48 overflow-y-auto">
          <div className="text-xs text-muted-foreground mb-1 px-1">Chat with agent:</div>
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                onNewConversation(agent.name)
                setShowNewChat(false)
              }}
              className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent/50 flex items-center gap-2 transition-colors"
            >
              <div className={`w-2 h-2 rounded-full ${statusColor(agent.status)}`} />
              <span className="font-medium text-foreground">{agent.name}</span>
              <span className="text-muted-foreground ml-auto">{agent.role}</span>
            </button>
          ))}
          {agents.length === 0 && (
            <div className="text-xs text-muted-foreground px-1 py-2">No agents registered</div>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No conversations yet
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => handleSelect(conv.id)}
              className={`w-full text-left p-3 border-b border-border/50 transition-colors ${
                activeConversation === conv.id
                  ? 'bg-accent/50'
                  : 'hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-foreground truncate max-w-[140px]">
                  {conv.lastMessage?.to_agent
                    ? `${conv.lastMessage.from_agent} → ${conv.lastMessage.to_agent}`
                    : conv.lastMessage?.from_agent || conv.id}
                </span>
                <div className="flex items-center gap-1">
                  {conv.unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {conv.unreadCount}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {conv.updatedAt ? timeAgo(conv.updatedAt) : ''}
                  </span>
                </div>
              </div>
              {conv.lastMessage && (
                <p className="text-xs text-muted-foreground truncate">
                  {conv.lastMessage.content}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
