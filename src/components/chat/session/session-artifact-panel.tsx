'use client'

import { MarkdownRenderer } from '@/components/markdown-renderer'
import { IconClose } from '../desktop/chat-icons'
import type { SessionArtifact } from '@/lib/session-artifacts'

export function SessionArtifactPanel({
  artifact,
  html,
  markdown,
  onClose,
}: {
  artifact: SessionArtifact
  html?: string | null
  markdown?: string | null
  onClose: () => void
}) {
  return (
    <aside className="hidden h-full w-[420px] shrink-0 flex-col border-l border-[var(--chat-border)] bg-[var(--chat-bg)] lg:flex">
      <div className="flex h-11 items-center gap-2 border-b border-[var(--chat-border)] px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--chat-text)]">{artifact.title}</span>
        {artifact.url ? (
          <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[var(--chat-muted)] hover:text-[var(--chat-text)]">
            Open
          </a>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Close artifact">
          <IconClose />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {html ? (
          <iframe title={artifact.title} srcDoc={html} sandbox="allow-scripts" className="h-full w-full border-0 bg-white" />
        ) : markdown ? (
          <div className="h-full overflow-y-auto px-5 py-4 text-[var(--chat-text)]">
            <div className="chat-plan-prose">
              <MarkdownRenderer content={markdown} />
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-[13px] text-[var(--chat-muted)]">
            {artifact.url ? 'Preview is local-only. Use Open to view this artifact.' : 'No preview available.'}
          </p>
        )}
      </div>
    </aside>
  )
}
