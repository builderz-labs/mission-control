'use client'

import { Button } from '@/components/ui/button'

interface ChatHeaderProps {
  isMobile: boolean
  showConversations: boolean
  focusMode: boolean
  isOverlay: boolean
  onlineCount: number
  onToggleConversations: () => void
  onToggleFocusMode: () => void
  onBackToList: () => void
  onClose?: () => void
}

export function ChatHeader({
  isMobile,
  showConversations,
  focusMode,
  isOverlay,
  onlineCount,
  onToggleConversations,
  onToggleFocusMode,
  onBackToList,
  onClose,
}: ChatHeaderProps): React.ReactElement {
  return (
    <div className={`glass-strong flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-4 ${focusMode ? 'h-10' : ''}`}>
      <div className="flex items-center gap-3">
        {/* Back button on mobile when in chat view */}
        {isMobile && !showConversations && (
          <Button onClick={onBackToList} variant="ghost" size="icon-xs">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </Button>
        )}
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
            <path d="M14 10c0 .37-.1.7-.28 1-.53.87-2.2 3-5.72 3-4.42 0-6-3-6-4V4a2 2 0 012-2h8a2 2 0 012 2v6z" />
            <path d="M6 7h.01M10 7h.01" />
          </svg>
          <span className="text-sm font-semibold text-foreground">Agent Chat</span>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {onlineCount} online
        </span>
      </div>

      <div className="flex items-center gap-1">
        {/* Focus mode toggle — desktop only */}
        <Button
          onClick={onToggleFocusMode}
          variant="ghost"
          size="icon-xs"
          className="hidden md:flex"
          title={focusMode ? 'Exit focus mode' : 'Focus mode'}
        >
          {focusMode ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 14h8M4 2h8M2 4v8M14 4v8" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2h4M10 2h4M2 14h4M10 14h4M2 2v4M14 2v4M2 14v-4M14 14v-4" />
            </svg>
          )}
        </Button>

        {/* Toggle conversations sidebar — desktop only */}
        <Button
          onClick={onToggleConversations}
          variant="ghost"
          size="icon-xs"
          className="hidden md:flex"
          title={showConversations ? 'Hide conversations' : 'Show conversations'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </Button>

        {isOverlay && onClose && (
          <Button onClick={onClose} variant="ghost" size="icon-xs" title="Close chat (Esc)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  )
}

/** Inline avatar for an agent, color-coded by role name */
export function AgentAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }): React.ReactElement {
  const colors: Record<string, string> = {
    coordinator: 'bg-purple-500/20 text-purple-400',
    aegis: 'bg-red-500/20 text-red-400',
    research: 'bg-green-500/20 text-green-400',
    ops: 'bg-orange-500/20 text-orange-400',
    reviewer: 'bg-teal-500/20 text-teal-400',
    content: 'bg-indigo-500/20 text-indigo-400',
    human: 'bg-primary/20 text-primary',
  }

  const colorClass = colors[name.toLowerCase()] ?? 'bg-muted text-muted-foreground'
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'

  return (
    <div className={`${sizeClass} ${colorClass} flex flex-shrink-0 items-center justify-center rounded-full font-bold`}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/** Derive human-readable conversation status from agent roster */
export function getConversationStatus(
  agents: Array<{ name: string; status: string }>,
  conversationId: string,
): string {
  if (conversationId.startsWith('session:')) {
    if (conversationId.includes('claude-code')) return 'Local Claude session'
    if (conversationId.includes('codex-cli')) return 'Local Codex session'
    if (conversationId.includes('hermes')) return 'Local Hermes session'
    return 'Gateway session'
  }
  const name = conversationId.replace('agent_', '')
  const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
  if (!agent) return 'Unknown'
  return agent.status === 'idle' || agent.status === 'busy' ? 'Online' : 'Offline'
}
