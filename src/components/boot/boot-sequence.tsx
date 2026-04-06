'use client'

// Encapsulates all boot-sequence state: step tracking, the 15-second failsafe
// that prevents an infinite loader when an API endpoint hangs, degraded-mode
// detection, and the client-hydration flag.  Lives here so page.tsx stays thin.

import { useEffect, useState } from 'react'
import { useMissionControl } from '@/store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootStep {
  readonly key: string
  readonly label: string
  readonly status: 'pending' | 'done'
}

export interface BootSequenceState {
  readonly isClient: boolean
  readonly bootDegradedWarning: boolean
  // Mutable array type so Loader's InitStep[] prop accepts it without widening;
  // immutability is enforced by the hook (every update returns a new array).
  readonly initSteps: BootStep[]
  readonly markStep: (key: string) => void
  readonly dismissDegradedWarning: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOT_STEPS_INITIAL: readonly BootStep[] = [
  { key: 'auth',         label: 'Authenticating operator',    status: 'pending' },
  { key: 'capabilities', label: 'Detecting station mode',     status: 'pending' },
  { key: 'config',       label: 'Loading control config',     status: 'pending' },
  { key: 'connect',      label: 'Connecting runtime links',   status: 'pending' },
  { key: 'agents',       label: 'Syncing agent registry',     status: 'pending' },
  { key: 'sessions',     label: 'Loading active sessions',    status: 'pending' },
  { key: 'projects',     label: 'Hydrating workspace board',  status: 'pending' },
  { key: 'memory',       label: 'Mapping memory graph',       status: 'pending' },
  { key: 'skills',       label: 'Indexing skill catalog',     status: 'pending' },
] as const

// How long to wait before force-completing any pending steps (ms).
// 15 s is long enough for slow cold starts but short enough that users are
// not stuck indefinitely if one service is down.
const BOOT_FAILSAFE_MS = 15_000

// Auto-dismiss the degraded-mode toast after this duration.
const DEGRADED_DISMISS_MS = 8_000

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBootSequence(): BootSequenceState {
  const { bootComplete, setBootComplete } = useMissionControl()

  const [isClient, setIsClient] = useState(false)
  const [bootDegradedWarning, setBootDegradedWarning] = useState(false)
  const [initSteps, setInitSteps] = useState<BootStep[]>([...BOOT_STEPS_INITIAL])

  // Mark the client as hydrated on first render so the loader can show steps.
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Advance a named step to 'done' — uses immutable spread to avoid mutation.
  const markStep = (key: string): void => {
    setInitSteps(prev => prev.map(s => (s.key === key ? { ...s, status: 'done' as const } : s)))
  }

  const dismissDegradedWarning = (): void => {
    setBootDegradedWarning(false)
  }

  // Complete boot once every step is done (debounced 400 ms for visual polish).
  useEffect(() => {
    if (bootComplete) return
    if (!initSteps.every(s => s.status === 'done')) return
    const t = setTimeout(() => setBootComplete(), 400)
    return () => clearTimeout(t)
  }, [initSteps, bootComplete, setBootComplete])

  // Failsafe: force-complete any still-pending steps after BOOT_FAILSAFE_MS so
  // the dashboard never gets stuck on the loader when an API endpoint hangs.
  // Intentionally mounted once — bootComplete is read inside the callback.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (bootComplete) return

      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Ultron] Boot failsafe triggered — forcing completion after 15s')
      }
      setInitSteps(prev =>
        prev.map(s => (s.status === 'pending' ? { ...s, status: 'done' as const } : s))
      )
      setBootDegradedWarning(true)
    }, BOOT_FAILSAFE_MS)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only failsafe; bootComplete checked inside callback
  }, [])

  // Auto-dismiss degraded toast after DEGRADED_DISMISS_MS.
  useEffect(() => {
    if (!bootDegradedWarning) return
    const dismiss = setTimeout(() => setBootDegradedWarning(false), DEGRADED_DISMISS_MS)
    return () => clearTimeout(dismiss)
  }, [bootDegradedWarning])

  return { isClient, bootDegradedWarning, initSteps, markStep, dismissDegradedWarning }
}

// ---------------------------------------------------------------------------
// DegradedModeToast
// ---------------------------------------------------------------------------

interface DegradedModeToastProps {
  readonly onDismiss: () => void
}

export function DegradedModeToast({ onDismiss }: DegradedModeToastProps): React.ReactElement {
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[80] flex items-start gap-2 rounded-lg border border-amber-700 bg-amber-950/90 px-4 py-3 shadow-2xl backdrop-blur max-w-sm"
    >
      <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
      <div>
        <p className="text-sm font-semibold text-amber-200">Degraded mode</p>
        <p className="mt-0.5 text-xs text-amber-300/80">
          Some services took too long to respond. The dashboard loaded in degraded mode.
        </p>
      </div>
      <button
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-auto shrink-0 text-amber-400 hover:text-amber-200 transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
