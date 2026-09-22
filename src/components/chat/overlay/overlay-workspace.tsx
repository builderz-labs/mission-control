'use client'

import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'
import { ConversationList } from '../conversation-list'
import { MessageList } from '../message-list'
import { ChatInput } from '../chat-input'
import { OverlaySessionView } from './overlay-session-view'
import { useChatConversations } from '../use-chat-conversations'
import { useSessionTranscript } from '../use-session-transcript'
import { useDesktopSend } from '../use-desktop-send'

export function OverlayWorkspace({ onClose }: { onClose?: () => void }) {
  const { activeConversation, setActiveConversation, conversations } = useMissionControl()
  const { agents } = useChatConversations()
  const selected = conversations.find((conv) => conv.id === activeConversation)
  const transcript = useSessionTranscript(selected?.session)
  const sender = useDesktopSend(transcript.refresh)
  const [showList, setShowList] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (!onClose) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (isMobile && activeConversation) setShowList(false)
  }, [isMobile, activeConversation])

  const canSend = !!activeConversation && !activeConversation.startsWith('session:')

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold">Agent Chat</span>
        {onClose && (
          <Button onClick={onClose} variant="ghost" size="icon-xs" title="Close chat (Esc)">
            ×
          </Button>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        {showList && (
          <div className={`${isMobile ? 'w-full' : 'w-56 border-r border-border'} shrink-0`}>
            <ConversationList onNewConversation={(name) => {
              setActiveConversation(`agent_${name}`)
              if (isMobile) setShowList(false)
            }} />
          </div>
        )}
        {(!isMobile || !showList) && (
          <div className="flex min-w-0 flex-1 flex-col">
            {selected?.session ? (
              <OverlaySessionView
                session={selected.session}
                messages={transcript.messages}
                loading={transcript.loading}
                error={transcript.error}
                onRefresh={transcript.refresh}
                onContinue={(prompt) => sender.sendSession(prompt, selected.session!)}
                busy={sender.busy}
                continueError={sender.error}
              />
            ) : (
              <>
                <MessageList />
                <ChatInput
                  onSend={(content, attachments) => {
                    if (activeConversation) void sender.sendAgent(content, activeConversation, attachments)
                  }}
                  disabled={!canSend}
                  agents={agents.map((agent) => ({ name: agent.name, role: agent.role }))}
                  isGenerating={sender.busy}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
