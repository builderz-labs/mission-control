'use client'

import { useEffect, useRef } from 'react'
import type { UsageLimitRow, UsageTone, UsageTracker } from '@/lib/chat-usage-tracker'

const BAR: Record<UsageTone, string> = {
  ok: 'bg-sky-400',
  warn: 'bg-amber-400',
  critical: 'bg-red-500',
}

export function UsagePopup({
  tracker,
  onClose,
}: {
  tracker: UsageTracker
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Usage limits"
      className="absolute bottom-10 right-0 z-30 w-[340px] rounded-xl border border-[var(--chat-border)] bg-[var(--chat-elevated)] p-3 shadow-2xl"
    >
      <Meter label={tracker.contextLabel} percent={tracker.contextPercent} tone="ok" detail={`${tracker.contextPercent}%`} />
      <p className="mt-3 text-[13px] text-[var(--chat-text)]">Your usage limits · {tracker.planLabel}</p>
      {tracker.limits.map((row) => (
        <LimitRow key={row.id} row={row} />
      ))}
    </div>
  )
}

function LimitRow({ row }: { row: UsageLimitRow }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[12px] text-[var(--chat-muted)]">
        <span>{row.title}</span>
        <span>{row.percent}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${BAR[row.tone]}`} style={{ width: `${row.percent}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-[var(--chat-muted)]">{row.resetsLabel}</p>
    </div>
  )
}

function Meter({ label, percent, tone, detail }: { label: string; percent: number; tone: UsageTone; detail: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] text-[var(--chat-muted)]">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${BAR[tone]}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
