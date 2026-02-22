'use client'

import { useEffect, useCallback, useState, useRef } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { ConversationList } from './conversation-list'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'

export function ChatPanel() {
  const {
    chatPanelOpen,
    setChatPanelOpen,
    activeConversation,
    setActiveConversation,
    setChatMessages,
    addChatMessage,
    replacePendingMessage,
    updatePendingMessage,
    setIsSendingMessage,
    agents,
    setAgents,
  } = useMissionControl()

  const pendingIdRef = useRef(-1)

  const [showConversations, setShowConversations] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // On mobile, hide conversations when a conversation is selected
  useEffect(() => {
    if (isMobile && activeConversation) {
      setShowConversations(false)
    }
  }, [isMobile, activeConversation])

  // Load agents list
  useEffect(() => {
    async function loadAgents() {
      try {
        const res = await fetch('/api/agents')
        if (!res.ok) return
        const data = await res.json()
        if (data.agents) setAgents(data.agents)
      } catch (err) {
        console.error('Failed to load agents:', err)
      }
    }
    if (chatPanelOpen) loadAgents()
  }, [chatPanelOpen, setAgents])

  // Load messages when conversation changes
  const loadMessages = useCallback(async () => {
    if (!activeConversation) return
    try {
      const res = await fetch(`/api/chat/messages?conversation_id=${encodeURIComponent(activeConversation)}&limit=100`)
      if (!res.ok) return
      const data = await res.json()
      if (data.messages) setChatMessages(data.messages)
    } catch (err) {
      console.error('Failed to load messages:', err)
    }
  }, [activeConversation, setChatMessages])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Poll for new messages (visibility-aware, 5s interval)
  useSmartPoll(loadMessages, 15000, {
    enabled: !!activeConversation && chatPanelOpen,
    pauseWhenSseConnected: true,
  })

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && chatPanelOpen) {
        setChatPanelOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chatPanelOpen, setChatPanelOpen])

  // Send message handler with optimistic updates
  const handleSend = async (content: string) => {
    if (!activeConversation) return

    const mentionMatch = content.match(/^@(\w+)\s/)
    let to = mentionMatch ? mentionMatch[1] : null
    const cleanContent = mentionMatch ? content.slice(mentionMatch[0].length) : content

    if (!to && activeConversation.startsWith('agent_')) {
      to = activeConversation.replace('agent_', '')
    }

    // Create optimistic message with negative temp ID
    pendingIdRef.current -= 1
    const tempId = pendingIdRef.current
    const optimisticMessage = {
      id: tempId,
      conversation_id: activeConversation,
      from_agent: 'human',
      to_agent: to,
      content: cleanContent,
      message_type: 'text' as const,
      created_at: Math.floor(Date.now() / 1000),
      pendingStatus: 'sending' as const,
    }

    // Show immediately
    addChatMessage(optimisticMessage)

    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'human',
          to,
          content: cleanContent,
          conversation_id: activeConversation,
          message_type: 'text',
          forward: true,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.message) {
          // Replace temp message with real server message
          replacePendingMessage(tempId, data.message)
        }
      } else {
        updatePendingMessage(tempId, { pendingStatus: 'failed' })
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      updatePendingMessage(tempId, { pendingStatus: 'failed' })
    }
  }

  const handleNewConversation = (agentName: string) => {
    const convId = `agent_${agentName}`
    setActiveConversation(convId)
    if (isMobile) setShowConversations(false)
  }

  const handleBackToList = () => {
    setShowConversations(true)
    if (isMobile) setActiveConversation(null)
  }

  if (!chatPanelOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:bg-black/20"
        onClick={() => setChatPanelOpen(false)}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed inset-0 md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[480px] lg:w-[560px] z-50 flex flex-col bg-card border-l border-border shadow-2xl slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-border glass-strong flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Back button on mobile when in chat view */}
            {isMobile && !showConversations && (
              <button
                onClick={handleBackToList}
                className="text-muted-foreground hover:text-foreground transition-smooth"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 12L6 8l4-4" />
                </svg>
              </button>
            )}
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                <path d="M14 10c0 .37-.1.7-.28 1-.53.87-2.2 3-5.72 3-4.42 0-6-3-6-4V4a2 2 0 012-2h8a2 2 0 012 2v6z" />
                <path d="M6 7h.01M10 7h.01" />
              </svg>
              <span className="text-sm font-semibold text-foreground">Agent Chat</span>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {agents.filter(a => a.status === 'busy' || a.status === 'idle').length} online
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Toggle conversations sidebar (desktop) */}
            <button
              onClick={() => setShowConversations(!showConversations)}
              className="hidden md:flex w-7 h-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              title={showConversations ? 'Hide conversations' : 'Show conversations'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
            </button>
            <button
              onClick={() => setChatPanelOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
              title="Close chat (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Conversations sidebar */}
          {showConversations && (
            <div className={`${isMobile ? 'w-full' : 'w-56 border-r border-border'} flex-shrink-0`}>
              <ConversationList onNewConversation={handleNewConversation} />
            </div>
          )}

          {/* Message area */}
          {(!isMobile || !showConversations) && (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Conversation header */}
              {activeConversation && (
                <div className="px-4 py-2 border-b border-border/50 bg-surface-1 flex items-center gap-2 flex-shrink-0">
                  <AgentAvatar name={activeConversation.replace('agent_', '')} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {activeConversation.replace('agent_', '')}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {getAgentStatus(agents, activeConversation)}
                    </div>
                  </div>
                </div>
              )}

              <MessageList />
              <ChatInput
                onSend={handleSend}
                disabled={!activeConversation}
                agents={agents.map(a => ({ name: a.name, role: a.role }))}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Inline avatar component
function AgentAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const colors: Record<string, string> = {
    coordinator: 'bg-purple-500/20 text-purple-400',
    forge: 'bg-blue-500/20 text-blue-400',
    aegis: 'bg-red-500/20 text-red-400',
    research: 'bg-green-500/20 text-green-400',
    ops: 'bg-orange-500/20 text-orange-400',
    reviewer: 'bg-teal-500/20 text-teal-400',
    content: 'bg-indigo-500/20 text-indigo-400',
    human: 'bg-primary/20 text-primary',
  }

  const colorClass = colors[name.toLowerCase()] || 'bg-muted text-muted-foreground'
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'

  return (
    <div className={`${sizeClass} ${colorClass} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function getAgentStatus(agents: any[], conversationId: string): string {
  const name = conversationId.replace('agent_', '')
  const agent = agents.find(a => a.name.toLowerCase() === name.toLowerCase())
  if (!agent) return 'Unknown'
  return agent.status === 'idle' || agent.status === 'busy' ? 'Online' : 'Offline'
}
