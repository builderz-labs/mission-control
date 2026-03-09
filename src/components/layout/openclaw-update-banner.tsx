'use client'

import { useState } from 'react'
import { useMissionControl } from '@/store'
import { Button } from '@/components/ui/button'

type UpdateState = 'idle' | 'updating' | 'success' | 'error'

export function OpenClawUpdateBanner() {
  const { openclawUpdate, openclawUpdateDismissedVersion, dismissOpenclawUpdate, setOpenclawUpdate } = useMissionControl()
  const [copied, setCopied] = useState(false)
  const [state, setState] = useState<UpdateState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)

  if (!openclawUpdate) return null
  if (openclawUpdateDismissedVersion === openclawUpdate.latest) return null

  function handleCopy() {
    navigator.clipboard.writeText(openclawUpdate!.updateCommand).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  async function handleUpdate() {
    setState('updating')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/openclaw/update', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setErrorMsg(data.detail || data.error || 'Update failed')
        return
      }

      setState('success')
      setNewVersion(data.newVersion)
      // Clear the banner after a few seconds
      setTimeout(() => setOpenclawUpdate(null), 5000)
    } catch {
      setState('error')
      setErrorMsg('Network error — could not reach the server.')
    }
  }

  const busy = state === 'updating'

  return (
    <div className="mx-4 mt-3 mb-0">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
        <p className="flex-1 text-xs text-cyan-300">
          {state === 'updating' && (
            <span className="font-medium text-amber-300">Updating OpenClaw...</span>
          )}
          {state === 'success' && (
            <span className="font-medium text-emerald-300">
              OpenClaw updated to v{newVersion || openclawUpdate.latest}
            </span>
          )}
          {state === 'error' && (
            <span className="font-medium text-red-300">{errorMsg}</span>
          )}
          {state === 'idle' && (
            <>
              <span className="font-medium text-cyan-200">
                OpenClaw update: v{openclawUpdate.latest} available
              </span>
              {' (installed: v'}{openclawUpdate.installed}{')'}
            </>
          )}
        </p>
        {!busy && state !== 'success' && (
          <>
            <button
              onClick={handleUpdate}
              className="shrink-0 text-2xs font-medium text-cyan-900 bg-cyan-500 hover:bg-cyan-400 px-2.5 py-1 rounded transition-colors"
            >
              Update Now
            </button>
            {openclawUpdate.releaseNotes && (
              <button
                onClick={() => setShowChangelog(v => !v)}
                className="shrink-0 text-2xs font-medium text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded border border-cyan-500/20 hover:border-cyan-500/40 transition-colors"
              >
                Changelog {showChangelog ? '▴' : '▾'}
              </button>
            )}
            <button
              onClick={handleCopy}
              className="shrink-0 text-2xs font-medium text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded border border-cyan-500/20 hover:border-cyan-500/40 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy Command'}
            </button>
            <a
              href={openclawUpdate.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-2xs font-medium text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded border border-cyan-500/20 hover:border-cyan-500/40 transition-colors"
            >
              View Release
            </a>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => dismissOpenclawUpdate(openclawUpdate.latest)}
              className="shrink-0 text-cyan-400/60 hover:text-cyan-300 hover:bg-transparent"
              title="Dismiss"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </Button>
          </>
        )}
        {busy && (
          <svg className="w-4 h-4 animate-spin text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
          </svg>
        )}
      </div>
      {showChangelog && openclawUpdate.releaseNotes && (
        <div className="mt-1 px-4 py-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10 text-xs text-cyan-300/80 whitespace-pre-wrap max-h-64 overflow-y-auto">
          {openclawUpdate.releaseNotes}
        </div>
      )}
    </div>
  )
}
