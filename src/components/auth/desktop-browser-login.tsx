'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface DesktopLoginRequest {
  request_id: string
  code: string
  expires_at: number
}

async function postJson(path: string, body?: object): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

export function DesktopBrowserLogin({ onAuthenticated, disabled = false }: {
  onAuthenticated: () => void
  disabled?: boolean
}) {
  const [request, setRequest] = useState<DesktopLoginRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await postJson('/api/auth/desktop-browser/request')
      const data = await response.json().catch(() => ({})) as Partial<DesktopLoginRequest> & { error?: string }
      if (!response.ok || !data.request_id || !data.code || !data.expires_at) {
        throw new Error(data.error || 'Could not start desktop sign-in')
      }
      setRequest(data as DesktopLoginRequest)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start desktop sign-in')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!request) return
    let stopped = false
    let timer = 0

    const poll = async () => {
      try {
        const response = await postJson('/api/auth/desktop-browser/poll', { request_id: request.request_id })
        if (response.ok) {
          const data = await response.json() as { status?: string }
          if (data.status === 'approved') {
            stopped = true
            onAuthenticated()
            return
          }
        } else if (response.status === 404 || response.status === 410) {
          stopped = true
          setRequest(null)
          setError('That code expired. Start again for a new code.')
          return
        }
      } catch {
        // A temporary network failure is retried by the next bounded poll.
      }
      if (!stopped) timer = window.setTimeout(poll, 2_000)
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, request.expires_at - Math.floor(Date.now() / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) {
        stopped = true
        setRequest(null)
        setError('That code expired. Start again for a new code.')
      }
    }
    updateCountdown()
    const countdown = window.setInterval(updateCountdown, 1_000)
    timer = window.setTimeout(poll, 1_000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.clearInterval(countdown)
    }
  }, [request, onAuthenticated])

  if (!request) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" className="w-full" disabled={disabled || busy} onClick={start}>
          {busy ? 'Starting secure sign-in…' : 'Sign in with the desktop app'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          No browser password needed. Approve a one-time code from the app you already use.
        </p>
        {error && <p role="alert" className="text-center text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Approve this browser from Mission Control</p>
        <p className="text-xs text-muted-foreground mt-1">Open the desktop app, then go to Settings → Browser access.</p>
      </div>
      <div className="rounded-md bg-background border border-border px-3 py-2 text-center">
        <span className="font-mono text-xl font-semibold tracking-[0.18em] text-foreground">{request.code}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Waiting for approval…</span>
        <span>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span>
      </div>
      <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setRequest(null)}>
        Cancel
      </Button>
    </div>
  )
}
