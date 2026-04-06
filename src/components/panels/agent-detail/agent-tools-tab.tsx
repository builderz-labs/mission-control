'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createClientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent } from './agent-detail-types'

const log = createClientLogger('ToolsTab')

interface ToolsTabProps {
  agent: Agent
}

export function ToolsTab({ agent }: ToolsTabProps) {
  const t = useTranslations('agentDetail')
  const agentConfig = (typeof agent.config === 'object' && agent.config !== null && !Array.isArray(agent.config)) ? agent.config as Record<string, unknown> : {} as Record<string, unknown>
  const toolsRaw = agentConfig.tools
  const tools = (typeof toolsRaw === 'object' && toolsRaw !== null && !Array.isArray(toolsRaw)) ? toolsRaw as Record<string, unknown> : {} as Record<string, unknown>
  const toolAllow = Array.isArray(tools.allow) ? tools.allow as string[] : []
  const toolDeny = Array.isArray(tools.deny) ? tools.deny as string[] : []
  const toolAlsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow as string[] : []
  const profile = (tools.profile as string) || 'default'

  const [allowList, setAllowList] = useState<string[]>(toolAllow)
  const [denyList, setDenyList] = useState<string[]>(toolDeny)
  const [alsoAllowList, setAlsoAllowList] = useState<string[]>(toolAlsoAllow)
  const [newAllow, setNewAllow] = useState('')
  const [newDeny, setNewDeny] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clear pending timer on unmount to prevent setState on unmounted component
  useEffect(() => () => { if (successTimerRef.current) clearTimeout(successTimerRef.current) }, [])

  const isDirty = JSON.stringify(allowList) !== JSON.stringify(toolAllow)
    || JSON.stringify(denyList) !== JSON.stringify(toolDeny)
    || JSON.stringify(alsoAllowList) !== JSON.stringify(toolAlsoAllow)

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
            tools: {
              ...tools,
              allow: allowList,
              deny: denyList,
              alsoAllow: alsoAllowList,
            },
          },
          write_to_gateway: true,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save tools')
      }
      setSuccess(true)
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccess(false), 2000)
    } catch (err: unknown) {
      log.error('Failed to save tools:', err)
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const addToList = (list: string[], setList: (v: string[]) => void, value: string) => {
    const trimmed = value.trim()
    if (!trimmed || list.includes(trimmed)) return
    setList([...list, trimmed])
  }

  const removeFromList = (list: string[], setList: (v: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index))
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-medium text-foreground">{t('toolConfiguration')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('profileLabel')}: <span className="font-mono text-foreground">{profile}</span>
          </p>
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

      {/* Allow list */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-green-400 mb-2">{t('allowListCount', { count: allowList.length })}</h5>
        <div className="flex flex-wrap gap-1 mb-3">
          {allowList.map((tool, i) => (
            <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded border border-green-500/20 flex items-center gap-1">
              {tool}
              <button onClick={() => removeFromList(allowList, setAllowList, i)} className="text-green-400/60 hover:text-green-400 ml-0.5">x</button>
            </span>
          ))}
          {allowList.length === 0 && <span className="text-xs text-muted-foreground">{t('noExplicitAllowList')}</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={newAllow}
            onChange={(e) => setNewAllow(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addToList(allowList, setAllowList, newAllow)
                setNewAllow('')
              }
            }}
            placeholder={t('addToolToAllowList')}
            className="flex-1 bg-surface-1 text-foreground rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button onClick={() => { addToList(allowList, setAllowList, newAllow); setNewAllow('') }} variant="secondary" size="xs">
            {t('add')}
          </Button>
        </div>
      </div>

      {/* Also-Allow list */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-cyan-400 mb-2">{t('alsoAllowCount', { count: alsoAllowList.length })}</h5>
        <p className="text-2xs text-muted-foreground mb-2">{t('alsoAllowDesc')}</p>
        <div className="flex flex-wrap gap-1 mb-3">
          {alsoAllowList.map((tool, i) => (
            <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded border border-cyan-500/20 flex items-center gap-1">
              {tool}
              <button onClick={() => removeFromList(alsoAllowList, setAlsoAllowList, i)} className="text-cyan-400/60 hover:text-cyan-400 ml-0.5">x</button>
            </span>
          ))}
          {alsoAllowList.length === 0 && <span className="text-xs text-muted-foreground">{t('none')}</span>}
        </div>
      </div>

      {/* Deny list */}
      <div className="bg-surface-1/50 rounded-lg p-4">
        <h5 className="text-sm font-medium text-red-400 mb-2">{t('denyListCount', { count: denyList.length })}</h5>
        <div className="flex flex-wrap gap-1 mb-3">
          {denyList.map((tool, i) => (
            <span key={`${tool}-${i}`} className="px-2 py-0.5 text-xs bg-red-500/10 text-red-400 rounded border border-red-500/20 flex items-center gap-1">
              {tool}
              <button onClick={() => removeFromList(denyList, setDenyList, i)} className="text-red-400/60 hover:text-red-400 ml-0.5">x</button>
            </span>
          ))}
          {denyList.length === 0 && <span className="text-xs text-muted-foreground">{t('noDeniedTools')}</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={newDeny}
            onChange={(e) => setNewDeny(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addToList(denyList, setDenyList, newDeny)
                setNewDeny('')
              }
            }}
            placeholder={t('addToolToDenyList')}
            className="flex-1 bg-surface-1 text-foreground rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button onClick={() => { addToList(denyList, setDenyList, newDeny); setNewDeny('') }} variant="secondary" size="xs">
            {t('add')}
          </Button>
        </div>
      </div>
    </div>
  )
}
