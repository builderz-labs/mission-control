'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export function JevWorkspaceShell({
  sidebar,
  header,
  children,
  compact = false,
}: {
  sidebar: React.ReactNode
  header: React.ReactNode
  children: React.ReactNode
  compact?: boolean
}) {
  const [railOpen, setRailOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!railOpen) return
    const previous = document.activeElement as HTMLElement | null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setRailOpen(false); return }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const controls = [...drawerRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'))
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    drawerRef.current?.querySelector<HTMLElement>('button, input')?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [railOpen])

  return (
    <div className="chat-desktop relative flex h-full min-h-0 overflow-hidden">
      <aside className={`hidden h-full w-72 shrink-0 border-r border-[var(--chat-border)] bg-[var(--chat-sidebar)] ${compact ? '' : 'md:flex'}`}>
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--chat-bg)]">
        <div className="flex min-h-11 shrink-0 items-center border-b border-[var(--chat-border)] px-3 md:px-5">
          <Button
            variant="ghost"
            size="sm"
            className={`mr-2 ${compact ? '' : 'md:hidden'}`}
            aria-haspopup="dialog"
            aria-expanded={railOpen}
            onClick={() => setRailOpen(true)}
          >
            Browse
          </Button>
          {header}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
      {railOpen && (
        <div className={`fixed inset-0 z-70 ${compact ? '' : 'md:hidden'}`}>
          <button
            type="button"
            aria-label="Close Jev navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setRailOpen(false)}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Jev navigation"
            className="absolute inset-y-0 left-0 flex w-[min(21rem,88vw)] flex-col bg-[var(--chat-sidebar)] shadow-2xl"
          >
            <div className="flex shrink-0 justify-end border-b border-[var(--chat-border)] px-2 py-1">
              <Button variant="ghost" size="sm" onClick={() => setRailOpen(false)}>Close</Button>
            </div>
            <div className="min-h-0 flex-1" onClick={(event) => { if ((event.target as HTMLElement).closest('button')) setRailOpen(false) }}>{sidebar}</div>
          </div>
        </div>
      )}
    </div>
  )
}
