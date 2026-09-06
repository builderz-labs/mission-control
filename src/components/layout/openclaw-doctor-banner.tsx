'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { apiFetch, ApiError } from '@/lib/api-client'
import { prepareDoctorBannerCopy } from '@/lib/doctor-banner-copy'

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

export function OpenClawDoctorBanner() {
  const t = useTranslations('doctorBanner')
  const tc = useTranslations('common')
  const [doctor, setDoctor] = useState<OpenClawDoctorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const doctorDismissedAt = useMissionControl(s => s.doctorDismissedAt)
  const dismissDoctor = useMissionControl(s => s.dismissDoctor)
  const [state, setState] = useState<BannerState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [fixProgress, setFixProgress] = useState<string>('')

  async function loadDoctorStatus() {
    try {
      const res = await apiFetch<Response>('/api/openclaw/doctor', {
        cache: 'no-store',
        raw: true,
      })
      if (!res.ok) {
        setDoctor(null)
        return
      }
      const data = await res.json()
      setDoctor(data)
    } catch {
      setDoctor(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const start = () => { void loadDoctorStatus() }
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(start, { timeout: 8000 })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(start, 2500)
    return () => window.clearTimeout(timer)
  }, [])

  async function handleFix() {
    setState('fixing')
    setErrorMsg(null)
    setFixProgress(t('runningFixes'))

    const progressMessages = [
      t('runningFixes'),
      t('cleaningSessionStores'),
      t('archivingOrphanTranscripts'),
      t('recheckingHealth'),
    ]
    let progressIndex = 0
    const progressTimer = window.setInterval(() => {
      progressIndex = (progressIndex + 1) % progressMessages.length
      setFixProgress(progressMessages[progressIndex] ?? progressMessages[0]!)
    }, 1400)

    try {
      const res = await apiFetch<Response>('/api/openclaw/doctor', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'fix_openclaw' }),
        raw: true,
      })
      const data = await res.json()
      window.clearInterval(progressTimer)

      if (!res.ok) {
        setState('error')
        setErrorMsg(data.error || t('fixFailed'))
        setFixProgress('')
        return
      }

      setDoctor(data.status)
      const progress = Array.isArray(data.progress) ? data.progress as OpenClawDoctorFixProgress[] : []
      setFixProgress(progress.map(item => item.detail).filter(Boolean).join(' '))
      setState(data.status?.healthy ? 'success' : 'idle')
      setShowDetails(false)
    } catch (error) {
      window.clearInterval(progressTimer)
      setState('error')
      if (error instanceof ApiError && error.code !== 'NETWORK_ERROR') {
        setErrorMsg(error.message || t('fixFailed'))
      } else {
        setErrorMsg(t('networkError'))
      }
      setFixProgress('')
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

  const bannerCopy = prepareDoctorBannerCopy(doctor.summary, doctor.issues)
  const visibleIssues = bannerCopy.issues.slice(0, 3)
  const extraCount = Math.max(bannerCopy.issues.length - visibleIssues.length, 0)
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
      <div className={`flex flex-col items-start gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row ${tone.frame}`}>
        <div className="flex w-full min-w-0 items-start gap-3 sm:flex-1">
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
          <p className="text-xs">
            <span className={`font-medium ${tone.primary}`}>{headline}</span>
            {' — '}
            {state === 'error' ? errorMsg || bannerCopy.summary : bannerCopy.summary}
          </p>
          {visibleIssues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {visibleIssues.map(issue => (
                <li key={issue} className="text-2xs opacity-90">{issue}</li>
              ))}
              {extraCount > 0 && (
                <li className="list-none text-2xs opacity-75">{tc('moreIssues', { count: extraCount })}</li>
              )}
            </ul>
          )}
          {busy && fixProgress && (
            <p className="mt-2 text-2xs opacity-85">{fixProgress}</p>
          )}
          {!busy && state === 'success' && fixProgress && (
            <p className="mt-2 text-2xs opacity-85">{fixProgress}</p>
          )}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
            onClick={() => setShowDetails(value => !value)}
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
            aria-label={tc('dismiss')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </div>
      </div>
      {showDetails && (
        <div className={`mt-1 max-h-80 overflow-y-auto rounded-lg border px-4 py-3 text-xs whitespace-pre-wrap ${tone.frame}`}>
          {doctor.raw || bannerCopy.summary}
        </div>
      )}
    </div>
  )
}
