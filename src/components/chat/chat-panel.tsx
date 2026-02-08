'use client'

import { useEffect, useCallback, useState } from 'react'
import { useMissionControl } from '@/store'
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
    setIsSendingMessage,
    agents,
    setAgents,
  } = useMissionControl()

  const [panelHeight, setPanelHeight] = useState(400)
  const [isResizing, setIsResizing] = useState(false)

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

  // Poll for new messages
  useEffect(() => {
    if (!activeConversation || !chatPanelOpen) return
    const interval = setInterval(loadMessages, 3000)
    return () => clearInterval(interval)
  }, [activeConversation, chatPanelOpen, loadMessages])

  // Send message handler
  const handleSend = async (content: string) => {
    if (!activeConversation) return
    setIsSendingMessage(true)

    // Parse recipient from @mention or conversation context
    const mentionMatch = content.match(/^@(\w+)\s/)
    let to = mentionMatch ? mentionMatch[1] : null
    const cleanContent = mentionMatch ? content.slice(mentionMatch[0].length) : content

    // If conversation is a direct chat (conv_agent_xxx), extract the agent name
    if (!to && activeConversation.startsWith('agent_')) {
      to = activeConversation.replace('agent_', '')
    }

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
          addChatMessage(data.message)
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setIsSendingMessage(false)
    }
  }

  // Create new conversation with an agent
  const handleNewConversation = (agentName: string) => {
    const convId = `agent_${agentName}`
    setActiveConversation(convId)
  }

  // Resize handler
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const startY = e.clientY
    const startHeight = panelHeight

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY
      setPanelHeight(Math.max(200, Math.min(startHeight + delta, window.innerHeight - 100)))
    }

    const onMouseUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  if (!chatPanelOpen) return null

  return (
    <div
      className="fixed bottom-0 left-64 right-0 bg-card border-t border-border shadow-2xl flex flex-col z-50"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className={`h-1 cursor-ns-resize hover:bg-primary/30 transition-colors ${isResizing ? 'bg-primary/50' : ''}`}
        onMouseDown={handleResizeStart}
      />

      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Agent Chat</span>
          <span className="text-xs text-muted-foreground">
            {agents.filter(a => a.status === 'busy' || a.status === 'idle').length} agents online
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPanelHeight(panelHeight === 400 ? 600 : 400)}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs px-2 py-1 rounded hover:bg-secondary"
            title={panelHeight === 400 ? 'Expand' : 'Shrink'}
          >
            {panelHeight === 400 ? '↑' : '↓'}
          </button>
          <button
            onClick={() => setChatPanelOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs px-2 py-1 rounded hover:bg-secondary"
            title="Close chat"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex overflow-hidden">
        <ConversationList onNewConversation={handleNewConversation} />
        <div className="flex-1 flex flex-col">
          <MessageList />
          <ChatInput
            onSend={handleSend}
            disabled={!activeConversation}
            agents={agents.map(a => ({ name: a.name, role: a.role }))}
          />
        </div>
      </div>
    </div>
  )
}
