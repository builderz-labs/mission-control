'use client'

/**
 * EplPanelFrame — shared chrome for the 5 EPL custom panels.
 *
 * v1 (26 May 2026): wraps an iframe pointing at the signed-off HTML mockup +
 * a dev banner pointing Jose at the matching Emergent prompt.
 *
 * Once the React lands, each panel file replaces its `<EplPanelFrame />`
 * call with the real component tree and this file can stay as the dev
 * fallback (use `?mockup=1` in the URL to force the iframe view).
 */

import { useEffect, useState } from 'react'

interface Props {
  id: 'today' | 'projects' | 'properties' | 'maintenance' | 'decisions' | 'agents-fleet'
  title: string
  mockupHref: string
  promptRef: string
  apiBase: string
}

export function EplPanelFrame({ id, title, mockupHref, promptRef, apiBase }: Props) {
  const [apiHealthy, setApiHealthy] = useState<'unknown' | 'ok' | 'down'>('unknown')

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}?part=summary`, { method: 'GET' })
      .then(r => {
        if (cancelled) return
        setApiHealthy(r.ok ? 'ok' : 'down')
      })
      .catch(() => {
        if (!cancelled) setApiHealthy('down')
      })
    return () => { cancelled = true }
  }, [apiBase])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <DevBanner id={id} title={title} promptRef={promptRef} apiBase={apiBase} apiHealthy={apiHealthy} />
      <iframe
        title={`${title} mockup preview`}
        src={mockupHref}
        style={{ border: 0, flex: 1, width: '100%', minHeight: 600 }}
      />
    </div>
  )
}

function DevBanner({
  id,
  title,
  promptRef,
  apiBase,
  apiHealthy,
}: {
  id: string
  title: string
  promptRef: string
  apiBase: string
  apiHealthy: 'unknown' | 'ok' | 'down'
}) {
  const healthIcon = apiHealthy === 'ok' ? '🟢' : apiHealthy === 'down' ? '🔴' : '⚪'
  return (
    <div
      style={{
        background: '#fef3c7',
        borderBottom: '1px solid #f59e0b',
        padding: '8px 16px',
        fontSize: 13,
        color: '#78350f',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <strong>STUB — {title} ({id})</strong>
      <span>Mockup view. Generate React via Emergent → {promptRef}</span>
      <span style={{ marginLeft: 'auto' }}>
        API {healthIcon} <code style={{ fontSize: 11 }}>{apiBase}</code>
      </span>
    </div>
  )
}
