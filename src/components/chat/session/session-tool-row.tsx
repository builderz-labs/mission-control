'use client'

import { useState } from 'react'
import { IconChevron } from '../desktop/chat-icons'

export function SessionToolRow({
  label,
  detail,
  children,
}: {
  label: string
  detail?: string
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-0.5">
      <button
        type="button"
        className="flex items-center gap-1 text-[13px] text-[var(--chat-muted)] hover:text-[var(--chat-text)]"
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevron className={open ? 'rotate-90' : ''} />
        <span>{label}</span>
        {detail ? <span className="truncate text-[12px] opacity-70">{detail}</span> : null}
      </button>
      {open && children ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-black/30 px-3 py-2 text-[12px] text-[var(--chat-muted)]">
          {children}
        </pre>
      ) : null}
    </div>
  )
}
