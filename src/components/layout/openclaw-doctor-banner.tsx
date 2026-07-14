'use client'

// Banner del doctor OpenClaw, versión fork Helix (HLX-290):
// - SIN botón "Run Doctor Fix" — la reparación automática desde UI rompió config
//   en el pasado (gotcha documentado); el remedio es manual y deliberado.
// - Colapsado a UNA línea por default; issues y raw solo bajo "detalles".
//   En móvil el banner upstream ocupaba la pantalla completa.

import { useEffect, useState } from 'react'
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

export function OpenClawDoctorBanner() {
  const t = useTranslations('doctorBanner')
  const tc = useTranslations('common')
  const [doctor, setDoctor] = useState<OpenClawDoctorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const doctorDismissedAt = useMissionControl(s => s.doctorDismissedAt)
  const dismissDoctor = useMissionControl(s => s.dismissDoctor)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    async function loadDoctorStatus() {
      try {
        const res = await fetch('/api/openclaw/doctor', { cache: 'no-store' })
        setDoctor(res.ok ? await res.json() : null)
      } catch {
        setDoctor(null)
      } finally {
        setLoading(false)
      }
    }
    void loadDoctorStatus()
  }, [])

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const dismissed = doctorDismissedAt != null && (Date.now() - doctorDismissedAt) < TWENTY_FOUR_HOURS

  if (loading || dismissed || !doctor || doctor.healthy) return null

  const tone =
    doctor.level === 'error'
      ? {
          frame: 'bg-destructive/10 border-destructive/20 text-destructive',
          dot: 'bg-destructive',
          secondary: 'text-destructive border-destructive/20 hover:border-destructive/40',
        }
      : {
          frame: 'bg-warning/10 border-warning/20 text-warning',
          dot: 'bg-warning',
          secondary: 'text-warning border-warning/20 hover:border-warning/40',
        }

  const headline =
    doctor.category === 'config'
      ? t('configDrift')
      : doctor.category === 'state'
        ? t('stateIntegrity')
        : doctor.category === 'security'
          ? t('securityWarning')
          : t('doctorWarnings')

  return (
    <div className="mx-4 mt-3 mb-0">
      <div className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border text-sm ${tone.frame}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <p className="min-w-0 flex-1 truncate text-xs">
          <span className="font-medium">{headline}</span>
          <span className="text-muted-foreground"> — {doctor.summary}</span>
          {doctor.issues.length > 0 && (
            <span className="text-muted-foreground"> ({doctor.issues.length})</span>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setShowDetails(value => !value)}
            className={`shrink-0 rounded border px-2 py-0.5 text-2xs font-medium transition-colors ${tone.secondary}`}
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
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </div>
      </div>
      {showDetails && (
        <div className={`mt-1 max-h-80 overflow-y-auto rounded-lg border px-4 py-3 text-xs ${tone.frame}`}>
          {doctor.issues.length > 0 && (
            <div className="mb-2 space-y-1">
              {doctor.issues.map(issue => (
                <p key={issue} className="opacity-90">- {issue}</p>
              ))}
            </div>
          )}
          <pre className="whitespace-pre-wrap font-mono text-2xs opacity-75">{doctor.raw || doctor.summary}</pre>
        </div>
      )}
    </div>
  )
}
