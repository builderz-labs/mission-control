'use client'

import { useEffect, useRef } from 'react'
import { permissionChip, nativePermissionMenu } from '@/lib/permission-menus'
import type { UnifiedPermissionMode } from '@/lib/permission-connector'
import { IconCheck } from '../desktop/chat-icons'

export function PermissionMenu({
  kind,
  mode,
  onChange,
  onClose,
}: {
  kind: string
  mode: UnifiedPermissionMode
  onChange: (mode: UnifiedPermissionMode) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const menu = nativePermissionMenu(kind)
  const heading = permissionChip(kind, mode).heading

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      const option = menu.find((item) => item.shortcut === event.key)
      if (option) {
        onChange(option.id)
        onClose()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onChange, onClose])

  if (menu.length === 0) return null

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute bottom-10 left-0 z-30 w-[360px] rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-2 shadow-2xl"
    >
      {heading ? <p className="px-2 pb-2 text-[13px] text-[var(--chat-text)]">{heading}</p> : null}
      {menu.map((option) => {
        const selected = option.id === mode
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5"
            onClick={() => { onChange(option.id); onClose() }}
          >
            <span className={`mt-0.5 flex h-4 w-4 items-center justify-center ${selected ? 'text-[var(--chat-text)]' : 'text-transparent'}`}>
              <IconCheck />
            </span>
            <span className="flex-1">
              <span className={`block text-[13px] ${option.accent && selected ? 'text-orange-400' : 'text-[var(--chat-text)]'}`}>
                {option.title}
              </span>
              <span className="block text-[12px] text-[var(--chat-muted)]">{option.description}</span>
            </span>
            {option.shortcut ? <span className="text-[11px] text-[var(--chat-muted)]">{option.shortcut}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
