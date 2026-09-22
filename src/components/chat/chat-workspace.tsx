'use client'

import { ChatDesktopWorkspace } from './desktop/chat-desktop-workspace'
import { OverlayWorkspace } from './overlay/overlay-workspace'

interface ChatWorkspaceProps {
  mode?: 'overlay' | 'embedded'
  onClose?: () => void
}

export function ChatWorkspace({ mode = 'embedded', onClose }: ChatWorkspaceProps) {
  if (mode === 'overlay') return <OverlayWorkspace onClose={onClose} />
  return <ChatDesktopWorkspace />
}
