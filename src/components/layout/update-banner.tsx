'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'
import { apiFetch, ApiError } from '@/lib/api-client'

type UpdateState = 'idle' | 'updating' | 'restarting' | 'error'

export function UpdateBanner() {
  const { updateAvailable, updateDismissedVersion, dismissUpdate } = useMissionControl()
  const t = useTranslations('updateBanner')
  const tc = useTranslations('common')
  const [state, setState] = useState<UpdateState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!updateAvailable) return null
  if (updateDismissedVersion === updateAvailable.latestVersion) return null

  async function handleUpdate() {
    setState('updating')
    setErrorMsg(null)

    try {
      const res = await apiFetch<Response>('/api/releases/update', {
        method: 'POST',
        body: JSON.stringify({
          targetVersion: updateAvailable!.latestVersion,
          confirmation: 'update_mission_control',
        }),
        raw: true,
      })
      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setErrorMsg(data.error || t('updateFailed'))
        return
      }

      if (data.restartRequired) {
        setState('restarting')
        // Poll until the server comes back up, then reload
        const poll = setInterval(async () => {
          try {
            const check = await apiFetch<Response>('/api/releases/check', {
              cache: 'no-store',
              raw: true,
            })
            if (check.ok) {
              clearInterval(poll)
              window.location.reload()
            }
          } catch {
            // Server still restarting
          }
        }, 2000)
        // Stop polling after 2 minutes
        setTimeout(() => {
          clearInterval(poll)
          setState('idle')
          window.location.reload()
        }, 120_000)
      } else {
        window.location.reload()
      }
    } catch (error) {
      setState('error')
      setErrorMsg(error instanceof ApiError && error.code !== 'NETWORK_ERROR'
        ? error.message || t('updateFailed')
        : t('networkError'))
    }
  }

  const isbusy = state === 'updating' || state === 'restarting'

  return (
    <div className="mx-4 mt-3 mb-0 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
      <p className="flex-1 text-xs text-emerald-300">
        {state === 'updating' && (
          <span className="font-medium text-amber-300">{t('updating')}</span>
        )}
        {state === 'restarting' && (
          <span className="font-medium text-amber-300">{t('restartingServer')}</span>
        )}
        {state === 'error' && (
          <span className="font-medium text-red-300">{errorMsg}</span>
        )}
        {state === 'idle' && (
          <>
            <span className="font-medium text-emerald-200">
              {t('updateAvailable', { version: updateAvailable.latestVersion })}
            </span>
            {t('newerVersionAvailable')}
          </>
        )}
      </p>
      {!isbusy && (
        <>
          <button
            onClick={handleUpdate}
            disabled={isbusy}
            className="shrink-0 text-2xs font-medium text-emerald-900 bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1 rounded transition-colors"
          >
            {tc('updateNow')}
          </button>
          <a
            href={updateAvailable.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-2xs font-medium text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded border border-emerald-500/20 hover:border-emerald-500/40 transition-colors"
          >
            {tc('viewRelease')}
          </a>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => dismissUpdate(updateAvailable.latestVersion)}
            className="shrink-0 text-emerald-400/60 hover:text-emerald-300 hover:bg-transparent"
            title={tc('dismiss')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </>
      )}
      {isbusy && (
        <svg className="w-4 h-4 animate-spin text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
        </svg>
      )}
    </div>
  )
}
