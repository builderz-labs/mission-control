'use client'

import { useCallback } from 'react'
import type { DiffEntry } from './gateway-config-types'

interface ActionDeps {
  hasChanges: boolean
  saving: boolean
  applying: boolean
  updating: boolean
  mode: 'form' | 'json'
  jsonText: string
  diff: DiffEntry[]
  configHash: string | null
  showFeedback: (ok: boolean, text: string) => void
  fetchConfig: () => Promise<void>
  setSaving: (v: boolean) => void
  setApplying: (v: boolean) => void
  setUpdating: (v: boolean) => void
  setConfigHash: (h: string | null) => void
}

interface Actions {
  handleSave: () => Promise<void>
  handleApply: () => Promise<void>
  handleUpdate: () => Promise<void>
}

/** Returns stable save/apply/update callbacks for the gateway-config panel */
export function useGatewayActions(deps: ActionDeps): Actions {
  const {
    hasChanges, saving, applying, updating, mode, jsonText, diff, configHash,
    showFeedback, fetchConfig, setSaving, setApplying, setUpdating, setConfigHash,
  } = deps

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return
    setSaving(true)
    try {
      const updates = buildUpdates(mode, jsonText, diff)
      if (updates === null) { showFeedback(false, 'Invalid JSON'); setSaving(false); return }

      const res = await fetch('/api/gateway-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, hash: configHash }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} field${data.count !== 1 ? 's' : ''}`)
        setConfigHash(data.hash ?? null)
        await fetchConfig()
      } else if (res.status === 409) {
        showFeedback(false, data.error || 'Conflict — please reload')
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }, [hasChanges, saving, mode, jsonText, diff, configHash, showFeedback, fetchConfig, setSaving, setConfigHash])

  const handleApply = useCallback(async () => {
    if (applying) return
    setApplying(true)
    try {
      if (hasChanges) await handleSave()
      const res = await fetch('/api/gateway-config?action=apply', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      showFeedback(res.ok, res.ok ? 'Config applied (hot reload)' : (data.error || 'Apply failed'))
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setApplying(false)
    }
  }, [applying, hasChanges, handleSave, showFeedback, setApplying])

  const handleUpdate = useCallback(async () => {
    if (updating) return
    setUpdating(true)
    try {
      const res = await fetch('/api/gateway-config?action=update', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      showFeedback(res.ok, res.ok ? 'System update initiated' : (data.error || 'Update failed'))
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setUpdating(false)
    }
  }, [updating, showFeedback, setUpdating])

  return { handleSave, handleApply, handleUpdate }
}

/** Convert current editor state to flat dot-notation update map; returns null on JSON parse error */
function buildUpdates(
  mode: 'form' | 'json',
  jsonText: string,
  diff: DiffEntry[],
): Record<string, unknown> | null {
  if (mode === 'form') {
    const updates: Record<string, unknown> = {}
    for (const d of diff) updates[d.path] = d.to
    return updates
  }
  try {
    const parsed = JSON.parse(jsonText)
    const updates: Record<string, unknown> = {}
    flattenObject(parsed, '', updates)
    return updates
  } catch {
    return null
  }
}

/** Recursively flatten nested object to dot-notation keys */
function flattenObject(obj: Record<string, unknown>, prefix: string, out: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenObject(v as Record<string, unknown>, path, out)
    } else {
      out[path] = v
    }
  }
}
