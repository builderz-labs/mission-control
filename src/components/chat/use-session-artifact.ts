'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { latestArtifact, type SessionArtifact } from '@/lib/session-artifacts'
import type { SessionTranscriptMessage } from './session-message'

export function useSessionArtifact(
  kind: string | undefined,
  sessionId: string | undefined,
  messages: SessionTranscriptMessage[],
): { artifact: SessionArtifact | null; html: string | null } {
  const artifact = useMemo(() => latestArtifact(messages), [messages])
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    if (!artifact || !kind || !sessionId) {
      setHtml(null)
      return
    }
    let cancelled = false
    apiFetch<{ html?: string | null }>(
      `/api/sessions/artifact?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(sessionId)}`,
    )
      .then((data) => { if (!cancelled) setHtml(data.html || null) })
      .catch(() => { if (!cancelled) setHtml(null) })
    return () => { cancelled = true }
  }, [artifact, kind, sessionId])
  return { artifact, html }
}
