'use client'

import type { HTMLAttributes } from 'react'
import { RAIL_DEFAULT } from '@/lib/rail-width'

type HandleProps = HTMLAttributes<HTMLDivElement> & {
  'aria-orientation'?: 'vertical' | 'horizontal'
  'aria-valuenow'?: number
  'aria-valuemin'?: number
  'aria-valuemax'?: number
}

export function ChatShell({
  sidebar,
  main,
  plan,
  sidebarWidth = RAIL_DEFAULT,
  resizeHandle,
}: {
  sidebar: React.ReactNode
  main: React.ReactNode
  plan?: React.ReactNode
  sidebarWidth?: number
  resizeHandle?: HandleProps
}) {
  return (
    <div className="relative z-10 flex h-full min-h-0 bg-[var(--chat-bg)]">
      <div
        className="relative hidden h-full shrink-0 md:block"
        style={{ width: sidebarWidth }}
      >
        {sidebar}
        <div
          {...resizeHandle}
          aria-label={resizeHandle?.['aria-label'] || 'Resize project list'}
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-white/20 focus-visible:bg-white/30"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--chat-bg)]">{main}</div>
      {plan}
    </div>
  )
}
