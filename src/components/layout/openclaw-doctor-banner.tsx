'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface OpenClawDoctorStatus {
  level: 'healthy' | 'warning' | 'error'
  category: 'config' | 'state' | 'security' | 'general'
  healthy: boolean
  summary: string
  issues: string[]
  canFix: boolean
  raw: string
}

interface OpenClawDoctorFixProgress {
  step: string
  detail: string
}

type BannerState = 'idle' | 'fixing' | 'success' | 'error'

const DISMISS_KEY = 'oc-doctor-dismissed-v1'

function getDismissedIssues(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveDismissedIssues(issues: string[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(issues))
  } catch {
    // ignore storage quota errors
  }
}

/** Returns true if all current issues were previously dismissed. */
function wasAlreadyDismissed(currentIssues: string[]): boolean {
  if (currentIssues.length === 0) return false
  const dismissed = getDismissedIssues()
  return currentIssues.every(issue => dismissed.includes(issue))
}

export function OpenClawDoctorBanner() {
  const [doctor, setDoctor] = useState<OpenClawDoctorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [state, setState] = useState<BannerState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [fixProgress, setFixProgress] = useState<string>('')

  async function loadDoctorStatus() {
    try {
      const res = await fetch('/api/openclaw/doctor', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        setDoctor(null)
        return
      }
      const data = await res.json() as OpenClawDoctorStatus
      setDoctor(data)
      // Auto-dismiss if these exact issues were already dismissed by the user
      if (wasAlreadyDismissed(data.issues)) {
        setDismissed(true)
      }
    } catch {
      setDoctor(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDoctorStatus()
  }, [])

  async function handleFix() {
    setState('fixing')
    setErrorMsg(null)
    setFixProgress('Running OpenClaw doctor fixes…')

    const progressMessages = [
      'Running OpenClaw doctor fixes…',
      'Cleaning session stores…',
      'Archiving orphan transcripts…',
      'Rechecking current instance health…',
    ]
    let progressIndex = 0
    const progressTimer = window.setInterval(() => {
      progressIndex = (progressIndex + 1) % progressMessages.length
      setFixProgress(progressMessages[progressIndex] ?? progressMessages[0]!)
    }, 1400)

    try {
      const res = await fetch('/api/openclaw/doctor', { method: 'POST', signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      window.clearInterval(progressTimer)

      if (!res.ok) {
        setState('error')
        setErrorMsg(data.detail || data.error || 'OpenClaw doctor fix failed')
        if (data.status) {
          setDoctor(data.status)
        }
        setFixProgress('')
        return
      }

      setDoctor(data.status)
      const progress = Array.isArray(data.progress) ? data.progress as OpenClawDoctorFixProgress[] : []
      setFixProgress(progress.map(item => item.detail).filter(Boolean).join(' '))
      try { localStorage.removeItem(DISMISS_KEY) } catch { /* ignore */ }
      // Always show success — even if some issues remain, the fix ran successfully.
      // Auto-dismiss the banner after a brief delay so the user sees confirmation.
      setState('success')
      setShowDetails(false)
      window.setTimeout(() => {
        setDismissed(true)
      }, 3000)
    } catch {
      window.clearInterval(progressTimer)
      setState('error')
      setErrorMsg('Network error — could not reach the server.')
      setFixProgress('')
    }
  }

  // Show banner when: not loading, not dismissed, doctor exists, and either
  // unhealthy OR we're in the success state (so user sees the "fix completed" message
  // before the auto-dismiss timer fires).
  if (loading || dismissed || !doctor || (doctor.healthy && state !== 'success')) return null

  const tone =
    state === 'success'
      ? {
          frame: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
          dot: 'bg-emerald-400',
          primary: 'text-emerald-200',
          button: 'text-emerald-950 bg-emerald-400 hover:bg-emerald-300',
          secondary: 'text-emerald-300 border-emerald-500/20 hover:border-emerald-500/40 hover:text-emerald-200',
        }
      : doctor.level === 'error'
        ? {
            frame: 'bg-red-500/10 border-red-500/20 text-red-300',
            dot: 'bg-red-500',
            primary: 'text-red-200',
            button: 'text-red-950 bg-red-400 hover:bg-red-300',
            secondary: 'text-red-300 border-red-500/20 hover:border-red-500/40 hover:text-red-200',
          }
        : {
            frame: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
            dot: 'bg-amber-400',
            primary: 'text-amber-200',
            button: 'text-amber-950 bg-amber-400 hover:bg-amber-300',
            secondary: 'text-amber-300 border-amber-500/20 hover:border-amber-500/40 hover:text-amber-200',
          }

  const visibleIssues = doctor.issues.slice(0, 3)
  const extraCount = Math.max(doctor.issues.length - visibleIssues.length, 0)
  const busy = state === 'fixing'
  const headline =
    state === 'success'
      ? (doctor.healthy ? 'OpenClaw doctor fix completed — all clear' : 'OpenClaw doctor fix applied')
      : doctor.category === 'config'
        ? 'OpenClaw config drift detected'
        : doctor.category === 'state'
          ? 'OpenClaw state integrity warning'
          : doctor.category === 'security'
            ? 'OpenClaw security warning'
            : 'OpenClaw doctor warnings'

  return (
    <div className="mx-4 mt-3 mb-0">
      <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${tone.frame}`}>
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs">
            <span className={`font-medium ${tone.primary}`}>{headline}</span>
            {' — '}
            {state === 'error'
              ? errorMsg || doctor.summary
              : state === 'success'
                ? (doctor.healthy ? 'All issues resolved.' : 'Fix applied. Remaining issues will recheck on next load.')
                : doctor.summary}
          </p>
          {visibleIssues.length > 0 && (
            <div className="mt-2 space-y-1">
              {visibleIssues.map(issue => (
                <p key={issue} className="text-2xs opacity-90">
                  - {issue}
                </p>
              ))}
              {extraCount > 0 && (
                <p className="text-2xs opacity-75">+ {extraCount} more issue{extraCount === 1 ? '' : 's'}</p>
              )}
            </div>
          )}
          {busy && fixProgress && (
            <p className="mt-2 text-2xs opacity-85">{fixProgress}</p>
          )}
          {!busy && state === 'success' && fixProgress && (
            <p className="mt-2 text-2xs opacity-85">{fixProgress}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {doctor.canFix && state !== 'success' && (
            <button
              onClick={handleFix}
              disabled={busy}
              className={`shrink-0 rounded px-2.5 py-1 text-2xs font-medium transition-colors ${tone.button}`}
            >
              {busy ? 'Running Fix…' : 'Run Doctor Fix'}
            </button>
          )}
          <button
            onClick={() => setShowDetails(value => !value)}
            className={`shrink-0 rounded border px-2 py-1 text-2xs font-medium transition-colors ${tone.secondary}`}
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              // Persist dismissed issues so banner stays hidden across reloads
              if (doctor) saveDismissedIssues(doctor.issues)
              setDismissed(true)
            }}
            className="shrink-0 hover:bg-transparent"
            title="Dismiss"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </div>
      </div>
      {showDetails && (
        <div className={`mt-1 max-h-80 overflow-y-auto rounded-lg border px-4 py-3 text-xs whitespace-pre-wrap ${tone.frame}`}>
          {doctor.raw || doctor.summary}
        </div>
      )}
    </div>
  )
}
