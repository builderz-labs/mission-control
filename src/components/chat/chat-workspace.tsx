'use client'

import { useEffect, useCallback, useMemo, useState } from 'react'
import { useMissionControl, type ChatAttachment } from '@/store'
import { ConversationList } from './conversation-list'
import { MessageList } from './message-list'
import { ChatInput } from './chat-input'

interface ChatWorkspaceProps {
  mode?: 'overlay' | 'embedded'
  onClose?: () => void
}

export function ChatWorkspace({ mode = 'embedded' }: ChatWorkspaceProps) {
  const { agents, conversations, activeConversation, setActiveConversation, addChatMessage } = useMissionControl()
  const [smartRoute, setSmartRoute] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<string>('')

  const agentOptions = useMemo(() => (agents || []).map((a) => ({ name: a.name, role: a.role || a.name })), [agents])

  useEffect(() => {
    if (!activeConversation && conversations.length > 0) setActiveConversation(conversations[0].id)
  }, [activeConversation, conversations, setActiveConversation])

  useEffect(() => {
    if (!selectedAgent && agentOptions.length > 0) setSelectedAgent(agentOptions[0].name)
  }, [agentOptions, selectedAgent])

  const routeMessage = useCallback(async (content: string, attachments?: ChatAttachment[]) => {
    const target = selectedAgent || agentOptions[0]?.name || 'coordinator'
    addChatMessage({
      id: `local-${Date.now()}`,
      conversation_id: activeConversation || 'agent_coordinator',
      from_agent: 'human',
      to_agent: target,
      content,
      message_type: 'text',
      attachments,
      created_at: Math.floor(Date.now() / 1000),
    } as any)

    if (smartRoute) {
      await fetch('/api/jarvis/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: content, agent_id: target, schedule: null }),
      }).catch(() => void 0)
    }
  }, [activeConversation, addChatMessage, agentOptions, selectedAgent, smartRoute])

  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] bg-background text-foreground">
      <aside className="border-r border-border bg-card/60 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Bridge</div>
            <div className="text-sm font-semibold">Conversations</div>
          </div>
          <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-500">Twin Agent</span>
        </div>
        <ConversationList onNewConversation={() => void 0} />
      </aside>
      <section className="flex min-h-0 flex-col">
        <div className="border-b border-border bg-card/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Lab</div>
              <div className="text-sm font-semibold">Chat + Intent Panels</div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={smartRoute} onChange={(e) => setSmartRoute(e.target.checked)} /> Smart route
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <MessageList />
        </div>
        <div className="border-t border-border bg-card/70 p-3">
          <ChatInput onSend={routeMessage} agents={agentOptions} />
        </div>
      </section>
    </div>
  )
}
