'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

export function AccountSettings() {
  const { currentUser } = useMissionControl()
  const [disconnecting, setDisconnecting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  if (!currentUser) return null

  const isGoogleConnected = currentUser.provider === 'google'

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST', signal: AbortSignal.timeout(8000) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setFeedback({ ok: true, text: 'Google account disconnected. You can now sign in with username and password.' })
        // Reload after a short delay so the user sees the feedback
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setFeedback({ ok: false, text: data.error || 'Failed to disconnect' })
      }
    } catch {
      setFeedback({ ok: false, text: 'Network error' })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-2">
        <h3 className="text-sm font-medium text-foreground">Account</h3>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Google icon */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              isGoogleConnected ? 'bg-white' : 'bg-muted'
            }`}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Google</span>
                {isGoogleConnected ? (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Connected</span>
                ) : (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Not connected</span>
                )}
              </div>
              {isGoogleConnected && currentUser.email ? (
                <p className="text-xs text-muted-foreground mt-0.5">{currentUser.email}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">Link your Google account for OAuth sign-in</p>
              )}
            </div>
          </div>

          {isGoogleConnected && (
            <Button
              onClick={handleDisconnect}
              disabled={disconnecting}
              variant="outline"
              size="sm"
              className="text-xs hover:text-destructive hover:border-destructive/50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          )}
        </div>

        {feedback && (
          <div className={`mt-3 rounded-md p-2.5 text-xs font-medium ${
            feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
          }`}>
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  )
}
