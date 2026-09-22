'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { extractApiErrorMessage } from '@/lib/api-error-message'
import { transcriptFingerprint } from '@/lib/transcript-fingerprint'
import type { Conversation } from '@/store'
import type { SessionTranscriptMessage } from './session-message'

const ACTIVE_MS = 1500
const IDLE_MS = 8000

function transcriptUrl(session: NonNullable<Conversation['session']>): string {
  if (session.sessionKind === 'gateway') {
    return `/api/sessions/transcript/gateway?key=${encodeURIComponent(session.sessionKey || session.sessionId)}&limit=50`
  }
  return `/api/sessions/transcript?kind=${encodeURIComponent(session.sessionKind)}&id=${encodeURIComponent(session.sessionId)}&limit=80&live=1`
}

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message)))
}

export interface TranscriptPollOptions {
  /** Poll cadence for a live session. Grid panes back off so a wall of
   *  terminals does not multiply the request rate by the number of cells. */
  activeMs?: number
  idleMs?: number
}

export function useSessionTranscript(
  session: Conversation['session'] | undefined,
  options: TranscriptPollOptions = {},
) {
  const [messages, setMessages] = useState<SessionTranscriptMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const print = useRef('')
  const sessionRef = useRef(session)
  sessionRef.current = session
  const sessionId = session?.sessionId
  const sessionKind = session?.sessionKind
  const active = !!session?.active
  const activeMs = options.activeMs ?? ACTIVE_MS
  const idleMs = options.idleMs ?? IDLE_MS

  const load = useCallback(async (
    current: NonNullable<Conversation['session']>,
    initial: boolean,
    signal: AbortSignal,
  ) => {
    if (initial) setLoading(true)
    try {
      const data = await apiFetch<{ messages?: SessionTranscriptMessage[] }>(transcriptUrl(current), { signal })
      if (signal.aborted) return
      const next = Array.isArray(data?.messages) ? data.messages : []
      const mark = transcriptFingerprint(next)
      if (mark !== print.current) {
        print.current = mark
        setMessages(next)
      }
      setError(null)
    } catch (err) {
      if (signal.aborted || isAbort(err)) return
      if (initial) {
        setMessages([])
        setError(extractApiErrorMessage(err, 'Failed to load transcript'))
      }
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    print.current = ''
    setMessages([])
    setError(null)
    if (!sessionId || !sessionKind || !sessionRef.current) return
    const ac = new AbortController()
    void load(sessionRef.current, true, ac.signal)
    const tick = () => {
      const current = sessionRef.current
      if (!current || document.visibilityState === 'hidden' || ac.signal.aborted) return
      void load(current, false, ac.signal)
    }
    const id = window.setInterval(tick, active ? activeMs : idleMs)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      ac.abort()
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [sessionId, sessionKind, active, activeMs, idleMs, load])

  const refresh = useCallback(() => {
    const current = sessionRef.current
    if (!current) return
    void load(current, false, new AbortController().signal)
  }, [load])
  return { messages, loading, error, refresh }
}
