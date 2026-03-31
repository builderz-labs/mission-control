'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

type UpdateState = 'idle' | 'updating' | 'restarting' | 'error'

export function UpdateBanner() {
  const { updateAvailable, updateDismissedVersion, dismissUpdate, currentUser } = useMissionControl()
  const t = useTranslations('updateBanner')
  const tc = useTranslations('common')
  const isAdmin = currentUser?.role === 'admin'
  const autoUpdateSafe = updateAvailable?.autoUpdateSafe !== false
  const manualOnlyReason = updateAvailable?.manualOnlyReason
  const [state, setState] = useState<UpdateState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!updateAvailable) return null
  if (updateDismissedVersion === updateAvailable.latestVersion) return null

  async function handleUpdate() {
    if (!isAdmin) return
    if (typeof window !== 'undefined' && !window.confirm(`${tc('updateNow')} Mission Control to v${updateAvailable!.latestVersion}?`)) {
      return
    }
    setState('updating')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/releases/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVersion: updateAvailable!.latestVersion }),
      })
      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setErrorMsg(data.error || t('updateFailed'))
        return
      }

      if (data.restartRequired) {
        setState('restarting')
        const targetVersion = String(data.newVersion || updateAvailable!.latestVersion || '').replace(/^v/, '')
        // Poll until the server comes back up, then reload
        const poll = setInterval(async () => {
          try {
            const check = await fetch('/api/releases/check', { cache: 'no-store' })
            if (!check.ok) return
            const checkData = await check.json().catch(() => ({}))
            const currentVersion = String(checkData?.currentVersion || '').replace(/^v/, '')
            if (currentVersion && currentVersion === targetVersion) {
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
          setState('error')
          setErrorMsg('Update finished building but the new Mission Control runtime did not come back with the target version in time.')
        }, 120_000)
      } else {
        window.location.reload()
      }
    } catch {
      setState('error')
      setErrorMsg(t('networkError'))
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
      {!isbusy && isAdmin && autoUpdateSafe && (
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
      {!isbusy && isAdmin && !autoUpdateSafe && (
        <>
          <span className="shrink-0 text-2xs font-medium text-amber-300/80 max-w-[24rem] text-right">
            {manualOnlyReason || 'Automatic Mission Control updates are disabled for this checkout.'}
          </span>
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
      {!isbusy && !isAdmin && (
        <span className="shrink-0 text-2xs font-medium text-emerald-300/70">
          {tc('adminOnly')}
        </span>
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
