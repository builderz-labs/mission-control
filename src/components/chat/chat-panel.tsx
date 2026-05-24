'use client'

import { useMissionControl } from '@/store'
import { ChatWorkspace } from './chat-workspace'

export function ChatPanel() {
  const { chatPanelOpen, setChatPanelOpen } = useMissionControl()

  if (!chatPanelOpen) return null

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close chat panel"
        className="fixed inset-0 z-40 block w-full border-0 p-0 bg-black/40 backdrop-blur-sm md:bg-black/20 cursor-default"
        onClick={() => setChatPanelOpen(false)}
      />

      {/* Panel */}
      <div className="slide-in-right fixed inset-0 z-50 flex flex-col md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[480px] lg:w-[560px]">
        <ChatWorkspace mode="overlay" onClose={() => setChatPanelOpen(false)} />
      </div>
    </>
  )
}
