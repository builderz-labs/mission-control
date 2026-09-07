'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { FlyActivity } from '@/lib/fly-activity'

export function FlySessionStatus({ sessionId }: { sessionId: string }) {
  const [snapshot,setSnapshot] = useState<{session:string;activity:FlyActivity} | null>(null)
  const [error,setError] = useState(false)
  const inFlight = useRef(false)
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const data = await apiFetch<{transport:string;activity:FlyActivity}>('/api/fly/status?session_id='+encodeURIComponent(sessionId), { signal: AbortSignal.timeout(8000) })
      if (data.transport !== 'polled' || !data.activity || !Number.isInteger(data.activity.active_workers)) throw Error('Unavailable status')
      setSnapshot({session:sessionId,activity:data.activity}); setError(false)
    } catch { setError(true) } finally { inFlight.current = false }
  },[sessionId])
  useSmartPoll(refresh,5000,{backoff:true})
  const activity = snapshot?.session === sessionId ? snapshot.activity : null
  if (!activity?.submissions) return error ? <p className="px-6 py-2 text-xs text-muted-foreground">Fly session status unavailable; no activation confirmed.</p> : null
  return <aside className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-2 text-xs" aria-label="Fly session metrics" aria-live="polite">
    <Image src="/fly-logo.svg" alt="Fly.io" width={80} height={28} className="h-9 w-24 rounded bg-white p-2" unoptimized />
    <span>{error ? 'Last known · ' : ''}{activity.active_workers} active Fly workers · {activity.queued} queued</span>
    <span className="tabular-nums">${activity.estimated_compute_usd.toFixed(4)} session compute estimate</span>
    <Link href="/fly" className="underline">Worker details</Link>
    <span className="text-muted-foreground">5s polling · excludes inference and invoice adjustments</span>
  </aside>
}
