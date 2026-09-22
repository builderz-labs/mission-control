'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiFetch, ApiError } from '@/lib/api-client'

function formatCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8)
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact
}

export function DesktopBrowserApproval() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const approve = async () => {
    if (code.replace('-', '').length !== 8) return
    setBusy(true)
    setFeedback(null)
    try {
      await apiFetch('/api/auth/desktop-browser/approve', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      setCode('')
      setFeedback({ ok: true, text: 'Browser approved. It will sign in automatically.' })
    } catch (error) {
      const text = error instanceof ApiError && error.status === 403
        ? 'Open this Settings page in the Mission Control desktop app to approve a browser.'
        : error instanceof Error ? error.message : 'Could not approve that code.'
      setFeedback({ ok: false, text })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface-1/50 p-4 space-y-3" aria-labelledby="browser-access-title">
      <div>
        <h2 id="browser-access-title" className="text-sm font-medium text-foreground">Browser access</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Sign in to a browser without revealing or resetting your Mission Control password.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={code}
          onChange={(event) => setCode(formatCode(event.target.value))}
          placeholder="ABCD-2345"
          aria-label="One-time browser sign-in code"
          autoComplete="one-time-code"
          inputMode="text"
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 font-mono tracking-wider text-sm uppercase focus:outline-hidden focus:ring-2 focus:ring-primary/50"
        />
        <Button type="button" onClick={approve} disabled={busy || code.replace('-', '').length !== 8}>
          {busy ? 'Approving…' : 'Approve browser'}
        </Button>
      </div>
      {feedback && (
        <p role="status" className={`text-xs ${feedback.ok ? 'text-green-400' : 'text-destructive'}`}>
          {feedback.text}
        </p>
      )}
      <p className="text-2xs text-muted-foreground">
        Codes expire after five minutes and work once. Mission Control never sends your password to the browser.
      </p>
    </section>
  )
}
