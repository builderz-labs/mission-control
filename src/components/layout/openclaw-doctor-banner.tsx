'use client'

import { useEffect, useReducer } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'

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

interface DoctorBannerState {
  doctor: OpenClawDoctorStatus | null
  loading: boolean
  state: BannerState
  errorMsg: string | null
  showDetails: boolean
  fixProgress: string
}

type DoctorBannerAction =
  | { type: 'SET_DOCTOR'; doctor: OpenClawDoctorStatus | null }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_STATE'; state: BannerState }
  | { type: 'SET_ERROR_MSG'; errorMsg: string | null }
  | { type: 'SET_SHOW_DETAILS'; showDetails: boolean }
  | { type: 'SET_FIX_PROGRESS'; fixProgress: string }

function doctorBannerReducer(s: DoctorBannerState, a: DoctorBannerAction): DoctorBannerState {
  switch (a.type) {
    case 'SET_DOCTOR': return { ...s, doctor: a.doctor }
    case 'SET_LOADING': return { ...s, loading: a.loading }
    case 'SET_STATE': return { ...s, state: a.state }
    case 'SET_ERROR_MSG': return { ...s, errorMsg: a.errorMsg }
    case 'SET_SHOW_DETAILS': return { ...s, showDetails: a.showDetails }
    case 'SET_FIX_PROGRESS': return { ...s, fixProgress: a.fixProgress }
    default: return s
  }
}

export function OpenClawDoctorBanner() {
  const t = useTranslations('doctorBanner')
  const tc = useTranslations('common')
  const [bannerState, dispatch] = useReducer(doctorBannerReducer, {
    doctor: null,
    loading: true,
    state: 'idle',
    errorMsg: null,
    showDetails: false,
    fixProgress: '',
  })
  const { doctor, loading, state, errorMsg, showDetails, fixProgress } = bannerState
  const doctorDismissedAt = useMissionControl(s => s.doctorDismissedAt)
  const dismissDoctor = useMissionControl(s => s.dismissDoctor)

  async function loadDoctorStatus() {
    try {
      const res = await fetch('/api/openclaw/doctor', { cache: 'no-store' })
      if (!res.ok) {
        dispatch({ type: 'SET_DOCTOR', doctor: null })
        return
      }
      const data = await res.json()
      dispatch({ type: 'SET_DOCTOR', doctor: data })
    } catch {
      dispatch({ type: 'SET_DOCTOR', doctor: null })
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false })
    }
  }

  useEffect(() => {
    void loadDoctorStatus()
  }, [])

  async function handleFix() {
    dispatch({ type: 'SET_STATE', state: 'fixing' })
    dispatch({ type: 'SET_ERROR_MSG', errorMsg: null })
    dispatch({ type: 'SET_FIX_PROGRESS', fixProgress: t('runningFixes') })

    const progressMessages = [
      t('runningFixes'),
      t('cleaningSessionStores'),
      t('archivingOrphanTranscripts'),
      t('recheckingHealth'),
    ]
    let progressIndex = 0
    const progressTimer = window.setInterval(() => {
      progressIndex = (progressIndex + 1) % progressMessages.length
      dispatch({ type: 'SET_FIX_PROGRESS', fixProgress: progressMessages[progressIndex] ?? progressMessages[0]! })
    }, 1400)

    try {
      const res = await fetch('/api/openclaw/doctor', { method: 'POST' })
      const data = await res.json()
      window.clearInterval(progressTimer)

      if (!res.ok) {
        dispatch({ type: 'SET_STATE', state: 'error' })
        dispatch({ type: 'SET_ERROR_MSG', errorMsg: data.detail || data.error || t('fixFailed') })
        if (data.status) {
          dispatch({ type: 'SET_DOCTOR', doctor: data.status })
        }
        dispatch({ type: 'SET_FIX_PROGRESS', fixProgress: '' })
        return
      }

      dispatch({ type: 'SET_DOCTOR', doctor: data.status })
      const progress = Array.isArray(data.progress) ? data.progress as OpenClawDoctorFixProgress[] : []
      dispatch({ type: 'SET_FIX_PROGRESS', fixProgress: progress.map(item => item.detail).filter(Boolean).join(' ') })
      dispatch({ type: 'SET_STATE', state: data.status?.healthy ? 'success' : 'idle' })
      dispatch({ type: 'SET_SHOW_DETAILS', showDetails: false })
    } catch {
      window.clearInterval(progressTimer)
      dispatch({ type: 'SET_STATE', state: 'error' })
      dispatch({ type: 'SET_ERROR_MSG', errorMsg: t('networkError') })
      dispatch({ type: 'SET_FIX_PROGRESS', fixProgress: '' })
    }
  }

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const dismissed = doctorDismissedAt != null && (Date.now() - doctorDismissedAt) < TWENTY_FOUR_HOURS

  if (loading || dismissed || !doctor || doctor.healthy) return null

  const tone =
    doctor.level === 'error'
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
      ? t('fixCompleted')
      : doctor.category === 'config'
        ? t('configDrift')
        : doctor.category === 'state'
          ? t('stateIntegrity')
          : doctor.category === 'security'
            ? t('securityWarning')
            : t('doctorWarnings')

  return (
    <div className="mx-4 mt-3 mb-0">
      <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${tone.frame}`}>
        <span className={`mt-1 size-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs">
            <span className={`font-medium ${tone.primary}`}>{headline}</span>
            {' — '}
            {state === 'error' ? errorMsg || doctor.summary : doctor.summary}
          </p>
          {visibleIssues.length > 0 && (
            <div className="mt-2 space-y-1">
              {visibleIssues.map(issue => (
                <p key={issue} className="text-2xs opacity-90">
                  - {issue}
                </p>
              ))}
              {extraCount > 0 && (
                <p className="text-2xs opacity-75">{tc('moreIssues', { count: extraCount })}</p>
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
              type="button"
              onClick={handleFix}
              disabled={busy}
              className={`shrink-0 rounded px-2.5 py-1 text-2xs font-medium transition-colors ${tone.button}`}
            >
              {busy ? t('runningFix') : t('runDoctorFix')}
            </button>
          )}
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_SHOW_DETAILS', showDetails: !showDetails })}
            className={`shrink-0 rounded border px-2 py-1 text-2xs font-medium transition-colors ${tone.secondary}`}
          >
            {showDetails ? tc('hideDetails') : tc('showDetails')}
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={dismissDoctor}
            className="shrink-0 hover:bg-transparent"
            title={tc('dismiss')}
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
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
