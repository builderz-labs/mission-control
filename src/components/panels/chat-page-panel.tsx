'use client'

import { ChatWorkspace } from '@/components/chat/chat-workspace'

export function ChatPagePanel() {
  return (
    <div className="chat-desktop h-full min-h-0 overflow-hidden">
      <ChatWorkspace mode="embedded" />
    </div>
  )
}
