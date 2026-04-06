'use client'

import { useEffect, useCallback, useState, useRef } from 'react'
import { useMissionControl, type ChatAttachment } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { ConversationList } from './conversation-list'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'
import { ChatHeader, AgentAvatar, getConversationStatus } from './chat-header'
import { ChatIndicators } from './chat-indicators'
import { SessionConversationView } from './session-conversation-view'
import { type SessionTranscriptMessage } from './session-message'

const log = createClientLogger('ChatWorkspace')

declare global {
  interface Window {
    __mcWebSocket?: WebSocket
  }
}

interface ChatWorkspaceProps {
  mode?: 'overlay' | 'embedded'
  onClose?: () => void
}

export function ChatWorkspace({ mode = 'embedded', onClose }: ChatWorkspaceProps): React.ReactElement {
  const {
    activeConversation,
    setActiveConversation,
    setChatMessages,
    setConversations,
    addChatMessage,
    replacePendingMessage,
    updatePendingMessage,
    agents,
    conversations,
    setAgents,
    notifications,
  } = useMissionControl()

  const pendingIdRef = useRef(-1)
  const [showConversations, setShowConversations] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [sessionTranscript, setSessionTranscript] = useState<SessionTranscriptMessage[]>([])
  const [sessionTranscriptLoading, setSessionTranscriptLoading] = useState(false)
  const [sessionTranscriptError, setSessionTranscriptError] = useState<string | null>(null)
  const [sessionReloadNonce, setSessionReloadNonce] = useState(0)

  const isOverlay = mode === 'overlay'
  const selectedConversation = conversations.find((c) => c.id === activeConversation)
  const selectedSession = selectedConversation?.session

  // Detect mobile viewport
  useEffect(() => {
    const check = (): void => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Auto-collapse sidebar when a conversation is selected on mobile
  useEffect(() => {
    if (isMobile && activeConversation) setShowConversations(false)
  }, [isMobile, activeConversation])

  // Load agents list once on mount
  useEffect(() => {
    async function loadAgents(): Promise<void> {
      try {
        const res = await fetch('/api/agents', { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const data = await res.json()
        if (data.agents) setAgents(data.agents)
      } catch (err) {
        log.error('Failed to load agents:', err)
      }
    }
    loadAgents()
  }, [setAgents])

  // Load messages when conversation changes
  const loadMessages = useCallback(async (): Promise<void> => {
    if (!activeConversation) return
    if (activeConversation.startsWith('session:')) {
      setChatMessages([])
      return
    }
    try {
      const res = await fetch(
        `/api/chat/messages?conversation_id=${encodeURIComponent(activeConversation)}&limit=100`,
        { signal: AbortSignal.timeout(8000) },
      )
      if (!res.ok) return
      const data = await res.json()
      if (data.messages) setChatMessages(data.messages)
    } catch (err) {
      log.error('Failed to load messages:', err)
    }
  }, [activeConversation, setChatMessages])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Poll for new messages when SSE is not connected
  useSmartPoll(loadMessages, 15000, {
    enabled: !!activeConversation && !activeConversation.startsWith('session:'),
    pauseWhenSseConnected: true,
  })

  // Close overlay on Escape
  useEffect(() => {
    if (!isOverlay || !onClose) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOverlay, onClose])

  // Send message with optimistic update
  const handleSend = async (content: string, attachments?: ChatAttachment[]): Promise<void> => {
    if (!activeConversation) return

    const mentionMatch = content.match(/^@(\w+)\s/)
    const to = mentionMatch
      ? mentionMatch[1]
      : activeConversation.startsWith('agent_')
        ? activeConversation.replace('agent_', '')
        : null
    const cleanContent = mentionMatch ? content.slice(mentionMatch[0].length) : content

    pendingIdRef.current -= 1
    const tempId = pendingIdRef.current
    addChatMessage({
      id: tempId,
      conversation_id: activeConversation,
      from_agent: 'human',
      to_agent: to,
      content: cleanContent,
      message_type: 'text' as const,
      attachments,
      created_at: Math.floor(Date.now() / 1000),
      pendingStatus: 'sending' as const,
    })
    setIsGenerating(true)

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
          attachments,
          forward: true,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.message) replacePendingMessage(tempId, data.message)
      } else {
        updatePendingMessage(tempId, { pendingStatus: 'failed' })
      }
    } catch (err) {
      log.error('Failed to send message:', err)
      updatePendingMessage(tempId, { pendingStatus: 'failed' })
    } finally {
      setIsGenerating(false)
    }
  }

  // Cancel in-flight generation via WebSocket RPC
  const handleAbort = useCallback((): void => {
    if (!activeConversation) return
    try {
      const ws = window.__mcWebSocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'req',
          method: 'chat.cancel',
          id: `mc-cancel-${Date.now()}`,
          params: { sessionId: activeConversation },
        }))
      }
    } catch (err) {
      log.error('Failed to send abort:', err)
    }
    setIsGenerating(false)
  }, [activeConversation])

  const handleNewConversation = (agentName: string): void => {
    setActiveConversation(`agent_${agentName}`)
    if (isMobile) setShowConversations(false)
  }

  const handleBackToList = (): void => {
    setShowConversations(true)
    if (isMobile) setActiveConversation(null)
  }

  // Load session transcript when a session-backed conversation is selected
  useEffect(() => {
    if (!selectedSession) {
      setSessionTranscript([])
      setSessionTranscriptError(null)
      return
    }

    let cancelled = false
    setSessionTranscriptLoading(true)
    setSessionTranscriptError(null)

    // Gateway sessions use a different transcript endpoint
    const url =
      selectedSession.sessionKind === 'gateway'
        ? `/api/sessions/transcript/gateway?key=${encodeURIComponent(selectedSession.sessionKey || selectedSession.sessionId)}&limit=50`
        : `/api/sessions/transcript?kind=${encodeURIComponent(selectedSession.sessionKind)}&id=${encodeURIComponent(selectedSession.sessionId)}&limit=40`

    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          throw new Error(payload?.error || 'Failed to load transcript')
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setSessionTranscript(Array.isArray(data?.messages) ? data.messages : [])
      })
      .catch((err) => {
        if (cancelled) return
        setSessionTranscript([])
        setSessionTranscriptError(err instanceof Error ? err.message : 'Failed to load transcript')
      })
      .finally(() => {
        if (!cancelled) setSessionTranscriptLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedSession, sessionReloadNonce])

  const refreshSessionTranscript = useCallback((): void => {
    setSessionReloadNonce((v) => v + 1)
  }, [])

  const handleSaveSessionPreferences = useCallback(async (payload: {
    prefKey: string
    displayName?: string
    colorTag?: string
  }): Promise<void> => {
    const res = await fetch('/api/chat/session-prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: payload.prefKey,
        name: payload.displayName ?? null,
        color: payload.colorTag ?? null,
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Failed to save session preferences')

    if (!activeConversation) return
    setConversations(
      conversations.map((conv) => {
        if (conv.id !== activeConversation || !conv.session) return conv
        return {
          ...conv,
          name: payload.displayName || conv.name,
          session: {
            ...conv.session,
            displayName: payload.displayName || conv.session.displayName,
            colorTag: payload.colorTag || undefined,
          },
        }
      }),
    )
  }, [activeConversation, conversations, setConversations])

  const canSendMessage = !!activeConversation && !activeConversation.startsWith('session:')
  const onlineCount = agents.filter((a) => a.status === 'busy' || a.status === 'idle').length

  return (
    <div className={`flex h-full flex-col bg-card ${focusMode ? 'fixed inset-0 z-50' : ''}`}>
      <ChatHeader
        isMobile={isMobile}
        showConversations={showConversations}
        focusMode={focusMode}
        isOverlay={isOverlay}
        onlineCount={onlineCount}
        onToggleConversations={() => setShowConversations((v) => !v)}
        onToggleFocusMode={() => setFocusMode((v) => !v)}
        onBackToList={handleBackToList}
        onClose={onClose}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Conversations sidebar */}
        {showConversations && !focusMode && (
          <div className={`${isMobile ? 'w-full' : 'w-56 border-r border-border'} flex-shrink-0`}>
            <ConversationList onNewConversation={handleNewConversation} />
          </div>
        )}

        {/* Message area */}
        {(!isMobile || !showConversations) && (
          <div className="flex min-w-0 flex-1 flex-col">
            {activeConversation && (
              <div className="bg-surface-1 flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2">
                <AgentAvatar
                  name={(selectedConversation?.name || activeConversation).replace('agent_', '')}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {(selectedConversation?.name || activeConversation).replace('agent_', '')}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {getConversationStatus(agents, activeConversation)}
                  </div>
                </div>
              </div>
            )}

            {selectedConversation?.source === 'session' && selectedConversation.session ? (
              <SessionConversationView
                session={selectedConversation.session}
                messages={sessionTranscript}
                loading={sessionTranscriptLoading}
                error={sessionTranscriptError}
                onRefreshTranscript={refreshSessionTranscript}
                onSavePreferences={handleSaveSessionPreferences}
              />
            ) : (
              <>
                <MessageList />
                <ChatIndicators notifications={notifications} />
                <ChatInput
                  onSend={handleSend}
                  onAbort={handleAbort}
                  disabled={!canSendMessage}
                  agents={agents.map((a) => ({ name: a.name, role: a.role }))}
                  isGenerating={isGenerating}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
