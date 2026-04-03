'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent } from './agent-detail-types'

const log = createClientLogger('ModelsTab')

interface ModelsTabProps {
  agent: Agent
}

export function ModelsTab({ agent }: ModelsTabProps) {
  const t = useTranslations('agentDetail')
  const agentConfig = (agent as any).config || {}
  const modelCfg = agentConfig.model || {}
  const modelPrimary = typeof modelCfg === 'string' ? modelCfg : (modelCfg.primary || '')
  const modelFallbacks: string[] = Array.isArray(modelCfg.fallbacks) ? modelCfg.fallbacks : []

  const [primary, setPrimary] = useState(modelPrimary)
  const [fallbacks, setFallbacks] = useState<string[]>(modelFallbacks)
  const [newFallback, setNewFallback] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ alias: string }>>([])
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clear pending timer on unmount to prevent setState on unmounted component
  useEffect(() => () => { if (successTimerRef.current) clearTimeout(successTimerRef.current) }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/status?action=models', { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.models) setAvailableModels(data.models)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const isDirty = primary !== modelPrimary || JSON.stringify(fallbacks) !== JSON.stringify(modelFallbacks)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_config: {
            model: {
              primary: (primary || '').trim(),
              fallbacks: fallbacks.filter(f => f && f.trim()),
            },
          },
          write_to_gateway: true,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save model config')
      }
      setSuccess(true)
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccess(false), 2000)
    } catch (err: unknown) {
      log.error('Failed to save model config:', err)
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const addFallback = () => {
    const trimmed = newFallback.trim()
    if (!trimmed || fallbacks.includes(trimmed)) return
    setFallbacks([...fallbacks, trimmed])
    setNewFallback('')
  }

  const removeFallback = (index: number) => {
    setFallbacks(fallbacks.filter((_, i) => i !== index))
  }

  const moveFallback = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= fallbacks.length) return
    const next = [...fallbacks]
    const [item] = next.splice(index, 1)
    next.splice(newIndex, 0, item)
    setFallbacks(next)
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('modelConfiguration')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{t('modelConfigurationDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          {success && <span className="text-xs text-green-400">{t('saved')}</span>}
          <Button onClick={handleSave} size="sm" disabled={saving || !isDirty}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Primary model */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-foreground mb-2">{t('primaryModel')}</h5>
        <select
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">{t('default')}</option>
          {availableModels.map(m => (
            <option key={m.alias} value={m.alias}>{m.alias}</option>
          ))}
          {primary && !availableModels.find(m => m.alias === primary) && (
            <option value={primary}>{primary}</option>
          )}
        </select>
      </div>

      {/* Fallback chain */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-foreground mb-2">{t('fallbackChainCount', { count: fallbacks.length })}</h5>
        <p className="text-2xs text-muted-foreground mb-3">
          {t('fallbackChainDesc')}
        </p>

        {fallbacks.length === 0 ? (
          <div className="text-xs text-muted-foreground mb-3">{t('noFallbackModels')}</div>
        ) : (
          <div className="space-y-1 mb-3">
            {fallbacks.map((fb, i) => (
              <div key={`${fb}-${i}`} className="flex items-center gap-2 bg-surface-1 rounded px-3 py-1.5">
                <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                <span className="flex-1 font-mono text-xs text-foreground">{fb}</span>
                <button
                  onClick={() => moveFallback(i, -1)}
                  disabled={i === 0}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                  title={t('moveUp')}
                >
                  ^
                </button>
                <button
                  onClick={() => moveFallback(i, 1)}
                  disabled={i === fallbacks.length - 1}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 px-1"
                  title={t('moveDown')}
                >
                  v
                </button>
                <button
                  onClick={() => removeFallback(i)}
                  className="text-xs text-red-400/60 hover:text-red-400 px-1"
                  title={t('remove')}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={newFallback}
            onChange={(e) => setNewFallback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addFallback()
              }
            }}
            list="model-fallback-suggestions"
            placeholder={t('addFallbackModel')}
            className="flex-1 bg-surface-1 text-foreground rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <datalist id="model-fallback-suggestions">
            {availableModels.map(m => (
              <option key={m.alias} value={m.alias} />
            ))}
          </datalist>
          <Button onClick={addFallback} variant="secondary" size="xs">
            {t('add')}
          </Button>
        </div>
      </div>
    </div>
  )
}
