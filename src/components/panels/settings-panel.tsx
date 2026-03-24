'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LanguageSwitcherSelect } from '@/components/ui/language-switcher'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { SecurityScanCard } from '@/components/onboarding/security-scan-card'
import { AgentRuntimesSection } from '@/components/settings/agent-runtimes-section'
import { Loader } from '@/components/ui/loader'
import { clearOnboardingDismissedThisSession, clearOnboardingReplayFromStart } from '@/lib/onboarding-session'
import { resolveCoordinatorDeliveryTarget, type CoordinatorAgentRecord } from '@/lib/coordinator-routing'
import type { GatewaySession } from '@/lib/sessions'

interface Setting {
  key: string
  value: string
  description: string
  category: string
  updated_by: string | null
  updated_at: number | null
  is_default: boolean
}

interface ApiKeyInfo {
  masked_key: string | null
  source: string
  last_rotated_at: number | null
  last_rotated_by: string | null
}

interface CoordinatorTargetAgent {
  name: string
  openclawId: string
  isDefault: boolean
  sessionKey: string | null
  configRaw: string
}

type CoordinatorSession = GatewaySession & { source?: string }

const COORDINATOR_AGENT = (process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').toLowerCase()

function parseCoordinatorTargetAgents(rawAgents: any[]): CoordinatorTargetAgent[] {
  const out: CoordinatorTargetAgent[] = []
  for (const raw of rawAgents || []) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) continue
    const config = raw?.config && typeof raw.config === 'object' ? raw.config : {}
    const openclawIdRaw = typeof config.openclawId === 'string' && config.openclawId.trim()
      ? config.openclawId.trim()
      : name
    const openclawId = openclawIdRaw.toLowerCase().replace(/\s+/g, '-')
    out.push({
      name,
      openclawId,
      isDefault: config.isDefault === true,
      sessionKey: typeof raw?.session_key === 'string' && raw.session_key.trim() ? raw.session_key.trim() : null,
      configRaw: JSON.stringify(config),
    })
  }

  const unique = new Map<string, CoordinatorTargetAgent>()
  for (const agent of out) {
    const key = agent.openclawId || agent.name.toLowerCase()
    if (!unique.has(key)) unique.set(key, agent)
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

const categoryLabels: Record<string, { label: string; icon: string; description: string }> = {
  general: { label: 'General', icon: '⚙', description: 'Core Mission Control settings' },
  security: { label: 'Security', icon: '🔑', description: 'API key management and security settings' },
  retention: { label: 'Data Retention', icon: '🗄', description: 'How long data is kept before cleanup' },
  chat: { label: 'Chat', icon: '💬', description: 'Coordinator routing and chat behavior settings' },
  gateway: { label: 'Gateway', icon: '🔌', description: 'OpenClaw gateway connection settings' },
  profiles: { label: 'Security Profiles', icon: 'shield', description: 'Hook profile controls security scanning strictness' },
  custom: { label: 'Custom', icon: '🔧', description: 'User-defined settings' },
}

const categoryOrder = ['general', 'security', 'profiles', 'retention', 'chat', 'gateway', 'custom']

// Dropdown options for subscription plan settings
const subscriptionDropdowns: Record<string, { label: string; value: string }[]> = {
  'subscription.plan_override': [
    { label: 'Auto-detect', value: '' },
    { label: 'Pro ($20/mo)', value: 'pro' },
    { label: 'Max ($100/mo)', value: 'max' },
    { label: 'Max 5x ($200/mo)', value: 'max_5x' },
    { label: 'Team ($30/mo)', value: 'team' },
    { label: 'Enterprise', value: 'enterprise' },
  ],
  'subscription.codex_plan': [
    { label: 'None', value: '' },
    { label: 'ChatGPT Free ($0/mo)', value: 'chatgpt' },
    { label: 'Plus ($20/mo)', value: 'plus' },
    { label: 'Pro ($200/mo)', value: 'pro' },
    { label: 'Team ($30/mo)', value: 'team' },
  ],
}

export function SettingsPanel() {
  const t = useTranslations('settings')
  const { currentUser, setShowOnboarding } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [settings, setSettings] = useState<Setting[]>([])
  const [grouped, setGrouped] = useState<Record<string, Setting[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Track edited values (key -> new value)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [activeCategory, setActiveCategory] = useState('general')

  // API key management state
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null)
  const [apiKeyLoading, setApiKeyLoading] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [rotateConfirm, setRotateConfirm] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [showSecurityScan, setShowSecurityScan] = useState(false)
  const [hookProfile, setHookProfile] = useState<string>('standard')
  const [hookProfileSaving, setHookProfileSaving] = useState(false)
  const [coordinatorTargetAgents, setCoordinatorTargetAgents] = useState<CoordinatorTargetAgent[]>([])
  const [coordinatorSessions, setCoordinatorSessions] = useState<CoordinatorSession[]>([])

  // Replay onboarding state
  const [replayingOnboarding, setReplayingOnboarding] = useState(false)

  // Hermes integration state
  const [hermesStatus, setHermesStatus] = useState<{
    installed: boolean
    gatewayRunning: boolean
    hookInstalled: boolean
    activeSessions: number
    cronJobCount?: number
    memoryEntries?: number
  } | null>(null)
  const [hermesLoading, setHermesLoading] = useState(false)
  const [hermesHookAction, setHermesHookAction] = useState(false)

  // Backup state
  const [mcBackupRunning, setMcBackupRunning] = useState(false)
  const [gwBackupRunning, setGwBackupRunning] = useState(false)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const getCoordinatorResolutionPreview = useCallback((configuredTarget: string) => {
    const allAgents: CoordinatorAgentRecord[] = coordinatorTargetAgents.map(agent => ({
      name: agent.name,
      session_key: agent.sessionKey,
      config: agent.configRaw,
    }))
    const directAgent = allAgents.find(agent => agent.name.toLowerCase() === COORDINATOR_AGENT) || null
    const gatewaySessions = coordinatorSessions.filter(session => (session.source || 'gateway') === 'gateway')

    const resolved = resolveCoordinatorDeliveryTarget({
      to: COORDINATOR_AGENT,
      coordinatorAgent: COORDINATOR_AGENT,
      directAgent,
      allAgents,
      sessions: gatewaySessions,
      configuredCoordinatorTarget: configuredTarget || null,
    })

    const viaLabel: Record<string, string> = {
      configured: 'configured target',
      default: 'default agent',
      main_session: 'live :main session',
      direct: 'coordinator record',
      fallback: 'fallback',
    }

    const targetLabel = `${resolved.deliveryName}${resolved.openclawAgentId ? ` (${resolved.openclawAgentId})` : ''}`
    return `Resolves now to ${targetLabel} via ${viaLabel[resolved.resolvedBy] || resolved.resolvedBy}.`
  }, [coordinatorTargetAgents, coordinatorSessions])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.status === 401) {
        window.location.assign('/login?next=%2Fsettings')
        return
      }
      if (res.status === 403) {
        setError('Admin access required')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to load settings')
        return
      }
      const data = await res.json()
      setSettings(data.settings || [])
      setGrouped(data.grouped || {})
      // Load hook profile from settings
      const hpSetting = (data.settings || []).find((s: Setting) => s.key === 'hook_profile')
      if (hpSetting) setHookProfile(hpSetting.value)

      // Load agent options for coordinator routing dropdown
      try {
        const agentsRes = await fetch('/api/agents?limit=200')
        if (agentsRes.ok) {
          const agentsData = await agentsRes.json()
          setCoordinatorTargetAgents(parseCoordinatorTargetAgents(agentsData.agents || []))
        }
      } catch {
        // non-critical
      }

      // Load live sessions to preview coordinator routing resolution
      try {
        const sessionsRes = await fetch('/api/sessions')
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json()
          const mapped: CoordinatorSession[] = Array.isArray(sessionsData.sessions)
            ? sessionsData.sessions.map((session: any) => ({
                key: String(session?.key || ''),
                agent: String(session?.agent || ''),
                source: typeof session?.source === 'string' ? session.source : undefined,
                sessionId: String(session?.id || session?.key || ''),
                updatedAt: Number(session?.lastActivity || session?.startTime || 0),
                chatType: String(session?.kind || 'unknown'),
                channel: String(session?.channel || ''),
                model: String(session?.model || ''),
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                contextTokens: 0,
                active: Boolean(session?.active),
              })).filter((session: CoordinatorSession) => session.key && session.agent)
            : []
          setCoordinatorSessions(mapped)
        }
      } catch {
        // non-critical
      }
    } catch {
      setError('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchApiKeyInfo = useCallback(async () => {
    setApiKeyLoading(true)
    try {
      const res = await fetch('/api/tokens/rotate')
      if (res.ok) {
        const data = await res.json()
        setApiKeyInfo(data)
      }
    } catch {
      // Silent — non-critical
    } finally {
      setApiKeyLoading(false)
    }
  }, [])

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      const res = await fetch('/api/tokens/rotate', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setNewApiKey(data.key)
        setRotateConfirm(false)
        setKeyCopied(false)
        showFeedback(true, 'API key rotated successfully')
        fetchApiKeyInfo()
      } else {
        showFeedback(false, data.error || 'Failed to rotate key')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setRotating(false)
    }
  }

  const handleCopyKey = async () => {
    if (!newApiKey) return
    try {
      await navigator.clipboard.writeText(newApiKey)
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    } catch {
      // Fallback: select and copy
      const el = document.createElement('textarea')
      el.value = newApiKey
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    }
  }

  const fetchHermesStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes')
      if (res.ok) {
        setHermesStatus(await res.json())
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchSettings(); fetchApiKeyInfo(); fetchHermesStatus() }, [fetchSettings, fetchApiKeyInfo, fetchHermesStatus])

  const handleEdit = (key: string, value: string) => {
    setEdits(prev => ({ ...prev, [key]: value }))
  }

  const hasChanges = Object.keys(edits).some(key => {
    const setting = settings.find(s => s.key === key)
    return setting && edits[key] !== setting.value
  })

  const handleSave = async () => {
    // Filter only actual changes
    const changes: Record<string, string> = {}
    for (const [key, value] of Object.entries(edits)) {
      const setting = settings.find(s => s.key === key)
      if (setting && value !== setting.value) {
        changes[key] = value
      }
    }

    if (Object.keys(changes).length === 0) return

    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: changes }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} setting${data.count === 1 ? '' : 's'}`)
        setEdits({})
        fetchSettings()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (key: string) => {
    try {
      const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Reset "${key}" to default`)
        setEdits(prev => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        fetchSettings()
      } else {
        showFeedback(false, data.error || 'Failed to reset')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const handleDiscard = () => {
    setEdits({})
  }

  if (loading) {
    return <Loader variant="panel" label="Loading settings" />
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const categories = categoryOrder.filter(c => c === 'security' || c === 'profiles' || (grouped[c]?.length > 0))

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button
              onClick={handleDiscard}
              variant="outline"
              size="sm"
            >
              {t('discard')}
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            variant={hasChanges ? 'default' : 'secondary'}
            size="sm"
            className={!hasChanges ? 'cursor-not-allowed' : ''}
          >
            {saving ? t('saving') : t('saveChanges')}
          </Button>
        </div>
      </div>

      {/* Workspace Info */}
      {currentUser?.role === 'admin' && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
          <strong className="text-blue-200">{t('workspaceManagementLabel')}</strong>{' '}
          {t('workspaceManagementDesc1')}{' '}
          <Button
            onClick={() => navigateToPanel('super-admin')}
            variant="link"
            size="xs"
            className="text-blue-400 hover:text-blue-300 p-0 h-auto"
          >
            {t('superAdmin')}
          </Button>{' '}
          {t('workspaceManagementDesc2')}
        </div>
      )}

      {/* Station Setup */}
      {currentUser?.role === 'admin' && (
        <div className="space-y-3">
          {/* Security Scan */}
          <div className="flex items-center gap-3 p-3 bg-surface-1/50 border border-border/30 rounded-lg">
            <div className="flex-1">
              <p className="text-xs font-medium">{t('security')}</p>
              <p className="text-2xs text-muted-foreground">{t('securityDescription')}</p>
            </div>
            <Button
              variant="outline"
              size="xs"
              className="text-2xs"
              onClick={() => setShowSecurityScan(v => !v)}
            >
              {showSecurityScan ? t('hideScan') : t('securityScan')}
            </Button>
          </div>
          {showSecurityScan && (
            <div className="p-4 bg-surface-1/30 border border-border/30 rounded-lg">
              <SecurityScanCard />
            </div>
          )}

          {/* Backup Actions */}
          <div className="flex items-center gap-3 p-3 bg-surface-1/50 border border-border/30 rounded-lg">
            <div className="flex-1">
              <p className="text-xs font-medium">{t('backups')}</p>
              <p className="text-2xs text-muted-foreground">{t('backupsDescription')}</p>
            </div>
            <Button
              variant="outline"
              size="xs"
              className="text-2xs"
              disabled={mcBackupRunning}
              onClick={async () => {
                setMcBackupRunning(true)
                try {
                  const res = await fetch('/api/backup', { method: 'POST' })
                  const data = await res.json()
                  if (res.ok) {
                    showFeedback(true, `MC backup created (${(data.backup?.size / 1024).toFixed(0)} KB)`)
                  } else {
                    showFeedback(false, data.error || 'MC backup failed')
                  }
                } catch {
                  showFeedback(false, 'Network error')
                } finally {
                  setMcBackupRunning(false)
                }
              }}
            >
              {mcBackupRunning ? t('backingUp') : t('backupMcDatabase')}
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="text-2xs"
              disabled={gwBackupRunning}
              onClick={async () => {
                setGwBackupRunning(true)
                try {
                  const res = await fetch('/api/backup?target=gateway', { method: 'POST' })
                  const data = await res.json()
                  if (res.ok) {
                    showFeedback(true, `Gateway backup created: ${data.output}`)
                  } else {
                    showFeedback(false, data.error || 'Gateway backup failed')
                  }
                } catch {
                  showFeedback(false, 'Network error')
                } finally {
                  setGwBackupRunning(false)
                }
              }}
            >
              {gwBackupRunning ? t('backingUp') : t('backupGatewayState')}
            </Button>
          </div>

          {/* Replay Onboarding */}
          <div className="flex items-center gap-3 p-3 bg-surface-1/50 border border-border/30 rounded-lg">
            <div className="flex-1">
              <p className="text-xs font-medium">{t('onboarding')}</p>
              <p className="text-2xs text-muted-foreground">{t('onboardingDescription')}</p>
            </div>
            <Button
              variant="outline"
              size="xs"
              className="text-2xs"
              disabled={replayingOnboarding}
              onClick={async () => {
                setReplayingOnboarding(true)
                try {
                  await fetch('/api/onboarding', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reset' }),
                  })
                  clearOnboardingDismissedThisSession()
                  clearOnboardingReplayFromStart()
                  setShowOnboarding(true)
                  showFeedback(true, 'Onboarding reset — wizard will appear on next page load')
                } catch {
                  showFeedback(false, 'Failed to reset onboarding')
                } finally {
                  setReplayingOnboarding(false)
                }
              }}
            >
              {replayingOnboarding ? t('resetting') : t('replayOnboarding')}
            </Button>
          </div>

          {/* Agent Runtimes */}
          <AgentRuntimesSection showFeedback={showFeedback} />

          {/* Hermes Agent Integration */}
          {hermesStatus?.installed && (
            <div className="p-3 bg-surface-1/50 border border-border/30 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">Hermes Agent</p>
                    <span className={`text-2xs px-1.5 py-0.5 rounded ${
                      hermesStatus.gatewayRunning
                        ? 'bg-green-500/15 text-green-400'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {hermesStatus.gatewayRunning ? 'Gateway running' : 'Gateway offline'}
                    </span>
                    {hermesStatus.activeSessions > 0 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
                        {hermesStatus.activeSessions} active
                      </span>
                    )}
                    {(hermesStatus.cronJobCount ?? 0) > 0 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                        {hermesStatus.cronJobCount} cron
                      </span>
                    )}
                    {(hermesStatus.memoryEntries ?? 0) > 0 && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                        {hermesStatus.memoryEntries} mem
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-muted-foreground mt-0.5">
                    {hermesStatus.hookInstalled
                      ? 'MC hook installed — receiving telemetry from hermes-agent'
                      : 'Install the MC hook for richer telemetry (agent status, session events)'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="text-2xs"
                  disabled={hermesHookAction}
                  onClick={async () => {
                    setHermesHookAction(true)
                    const action = hermesStatus.hookInstalled ? 'uninstall-hook' : 'install-hook'
                    try {
                      const res = await fetch('/api/hermes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action }),
                      })
                      const data = await res.json()
                      if (res.ok) {
                        showFeedback(true, data.message || `Hook ${action === 'install-hook' ? 'installed' : 'uninstalled'}`)
                        fetchHermesStatus()
                      } else {
                        showFeedback(false, data.error || 'Hook operation failed')
                      }
                    } catch {
                      showFeedback(false, 'Network error')
                    } finally {
                      setHermesHookAction(false)
                    }
                  }}
                >
                  {hermesHookAction
                    ? 'Working...'
                    : hermesStatus.hookInstalled
                      ? 'Uninstall Hook'
                      : 'Install MC Hook'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Language */}
      <LanguageSection />

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-border pb-px">
        {categories.map(cat => {
          const meta = categoryLabels[cat] || { label: cat, icon: '📋', description: '' }
          const changedCount = (grouped[cat] || []).filter(s => edits[s.key] !== undefined && edits[s.key] !== s.value).length
          return (
            <Button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              variant="ghost"
              size="sm"
              className={`rounded-t-md rounded-b-none relative ${
                activeCategory === cat
                  ? 'bg-card text-foreground border border-border border-b-card -mb-px'
                  : ''
              }`}
            >
              {meta.label}
              {changedCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-2xs rounded-full bg-primary text-primary-foreground">
                  {changedCount}
                </span>
              )}
            </Button>
          )
        })}
      </div>

      {/* Security: API Key Management */}
      {activeCategory === 'security' && (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">API Key</span>
                  {apiKeyInfo?.source && (
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {apiKeyInfo.source}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Used for programmatic access and agent authentication via X-Api-Key header or Bearer token.
                </p>
              </div>
            </div>

            {/* Current key display */}
            <div className="mt-3 flex items-center gap-2">
              <code className="text-xs font-mono bg-background border border-border rounded px-2 py-1 text-muted-foreground">
                {apiKeyLoading ? 'Loading...' : apiKeyInfo?.masked_key || 'No API key configured'}
              </code>
            </div>

            {apiKeyInfo?.last_rotated_at && (
              <div className="text-2xs text-muted-foreground/50 mt-2">
                Last rotated by {apiKeyInfo.last_rotated_by} on{' '}
                {new Date(apiKeyInfo.last_rotated_at * 1000).toLocaleDateString()}{' '}
                at {new Date(apiKeyInfo.last_rotated_at * 1000).toLocaleTimeString()}
              </div>
            )}

            {/* Rotate confirmation */}
            {!rotateConfirm ? (
              <div className="mt-3">
                <Button
                  onClick={() => setRotateConfirm(true)}
                  variant="outline"
                  size="sm"
                >
                  Rotate Key
                </Button>
              </div>
            ) : (
              <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-300 mb-2">
                  Are you sure? Rotating the API key will immediately invalidate the current key.
                  All agents and integrations using the old key will lose access.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleRotateKey}
                    disabled={rotating}
                    variant="default"
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {rotating ? 'Rotating...' : 'Confirm Rotate'}
                  </Button>
                  <Button
                    onClick={() => setRotateConfirm(false)}
                    variant="ghost"
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* New key display (shown once after rotation) */}
            {newApiKey && (
              <div className="mt-3 bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                <p className="text-xs text-green-300 mb-2 font-medium">
                  New API key generated. Copy it now -- it will not be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono bg-background border border-border rounded px-2 py-1.5 text-foreground select-all flex-1 break-all">
                    {newApiKey}
                  </code>
                  <Button
                    onClick={handleCopyKey}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    {keyCopied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <div className="mt-2">
                  <Button
                    onClick={() => setNewApiKey(null)}
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Security Profiles: Hook Profile Selector */}
      {activeCategory === 'profiles' && (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-foreground mb-1">Hook Profile</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Controls how aggressively security hooks scan tool calls and agent outputs.
            </p>
            <div className="space-y-2">
              {([
                { value: 'minimal', label: 'Minimal', desc: 'Basic safety checks only. Best for trusted environments with low risk tolerance overhead.' },
                { value: 'standard', label: 'Standard', desc: 'Balanced scanning for secrets, injections, and suspicious patterns. Recommended for most deployments.' },
                { value: 'strict', label: 'Strict', desc: 'Full depth scanning with aggressive blocking. May increase latency. Best for sensitive or compliance-driven environments.' },
              ] as const).map(profile => (
                <button
                  key={profile.value}
                  onClick={async () => {
                    setHookProfile(profile.value)
                    setHookProfileSaving(true)
                    try {
                      const res = await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: 'hook_profile', value: profile.value }),
                      })
                      if (res.ok) {
                        showFeedback(true, `Hook profile set to ${profile.label}`)
                      } else {
                        showFeedback(false, 'Failed to save hook profile')
                      }
                    } catch {
                      showFeedback(false, 'Network error')
                    } finally {
                      setHookProfileSaving(false)
                    }
                  }}
                  disabled={hookProfileSaving}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    hookProfile === profile.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/30 bg-secondary'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                      hookProfile === profile.value ? 'border-primary' : 'border-muted-foreground/50'
                    }`}>
                      {hookProfile === profile.value && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-foreground">{profile.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-5">{profile.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Interface Mode (General tab) */}
      {activeCategory === 'general' && (
        <InterfaceModeSelector />
      )}

      {/* Settings list for active category */}
      <div className="space-y-3">
        {activeCategory !== 'security' && (grouped[activeCategory] || []).map(setting => {
          const currentValue = edits[setting.key] ?? setting.value
          const isChanged = edits[setting.key] !== undefined && edits[setting.key] !== setting.value
          const isBooleanish = setting.value === 'true' || setting.value === 'false'
          const isNumeric = /^\d+$/.test(setting.value)
          const coordinatorTargetOptions = setting.key === 'chat.coordinator_target_agent'
            ? [
                { label: 'Auto (default/main-session fallback)', value: '' },
                ...coordinatorTargetAgents.map(agent => ({
                  label: `${agent.name}${agent.isDefault ? ' (default)' : ''} — ${agent.openclawId}`,
                  value: agent.openclawId,
                })),
              ]
            : null
          const dropdownOptions = coordinatorTargetOptions || subscriptionDropdowns[setting.key]
          const coordinatorPreview = setting.key === 'chat.coordinator_target_agent'
            ? getCoordinatorResolutionPreview(currentValue)
            : null
          const shortKey = setting.key.split('.').pop() || setting.key

          return (
            <div
              key={setting.key}
              className={`bg-card border rounded-lg p-4 transition-colors ${
                isChanged ? 'border-primary/50' : 'border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{formatLabel(shortKey)}</span>
                    {setting.is_default && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">default</span>
                    )}
                    {isChanged && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-primary/15 text-primary">modified</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
                  <p className="text-2xs text-muted-foreground/60 mt-1 font-mono">{setting.key}</p>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-2">
                    {dropdownOptions ? (
                      <select
                        value={currentValue}
                        onChange={e => handleEdit(setting.key, e.target.value)}
                        className="w-64 px-2 py-1 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                      >
                        {dropdownOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                        {currentValue && !dropdownOptions.some(opt => opt.value === currentValue) && (
                          <option value={currentValue}>Custom: {currentValue}</option>
                        )}
                      </select>
                    ) : isBooleanish ? (
                    <button
                      onClick={() => handleEdit(setting.key, currentValue === 'true' ? 'false' : 'true')}
                      className={`w-10 h-5 rounded-full relative transition-colors select-none ${
                        currentValue === 'true' ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        currentValue === 'true' ? 'left-5' : 'left-0.5'
                      }`} />
                    </button>
                  ) : isNumeric ? (
                    <input
                      type="number"
                      value={currentValue}
                      onChange={e => handleEdit(setting.key, e.target.value)}
                      className="w-24 px-2 py-1 text-sm text-right bg-background border border-border rounded-md focus:border-primary focus:outline-none font-mono"
                    />
                  ) : (
                    <input
                      type="text"
                      value={currentValue}
                      onChange={e => handleEdit(setting.key, e.target.value)}
                      className="w-48 px-2 py-1 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                    />
                  )}

                    {!setting.is_default && (
                      <Button
                        onClick={() => handleReset(setting.key)}
                        title="Reset to default"
                        variant="ghost"
                        size="icon-xs"
                        className="w-6 h-6"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 8a6 6 0 1111.3-2.8" strokeLinecap="round" />
                          <path d="M14 2v3.5h-3.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Button>
                    )}
                  </div>
                  {coordinatorPreview && (
                    <p className="text-2xs text-muted-foreground max-w-72 text-right">{coordinatorPreview}</p>
                  )}
                </div>
              </div>

              {setting.updated_by && setting.updated_at && (
                <div className="text-2xs text-muted-foreground/50 mt-2">
                  Last updated by {setting.updated_by} on {new Date(setting.updated_at * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Account / OAuth connection */}
      <AccountOAuthSection />

      {/* Unsaved changes bar */}
      {hasChanges && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs text-foreground">
            {Object.keys(edits).filter(k => {
              const s = settings.find(s => s.key === k)
              return s && edits[k] !== s.value
            }).length} unsaved change(s)
          </span>
          <Button
            onClick={handleDiscard}
            variant="ghost"
            size="xs"
          >
            {t('discard')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            size="xs"
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    </div>
  )
}

function InterfaceModeSelector() {
  const { interfaceMode, setInterfaceMode } = useMissionControl()
  const [saving, setSaving] = useState(false)
  const navigateToPanel = useNavigateToPanel()

  const handleChange = async (mode: 'essential' | 'full') => {
    setInterfaceMode(mode)
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { 'general.interface_mode': mode } }),
      })
      // If switching to essential and on a hidden panel, redirect
      if (mode === 'essential') {
        const essentialIds = new Set(['overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings'])
        const store = useMissionControl.getState()
        if (!essentialIds.has(store.activeTab)) {
          navigateToPanel('overview')
        }
      }
    } catch {}
    setSaving(false)
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-medium text-foreground mb-1">Interface Mode</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Controls how many panels appear in the sidebar.
      </p>
      <div className="space-y-2">
        {([
          { value: 'essential' as const, label: 'Essential', desc: 'Focused view with core panels only — Overview, Agents, Tasks, Chat, Activity, Logs, Settings.' },
          { value: 'full' as const, label: 'Full', desc: 'All panels and advanced features including Memory, Cron, Webhooks, Alerts, Audit, and more.' },
        ]).map(option => (
          <button
            key={option.value}
            onClick={() => handleChange(option.value)}
            disabled={saving}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              interfaceMode === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30 bg-secondary'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                interfaceMode === option.value ? 'border-primary' : 'border-muted-foreground/50'
              }`}>
                {interfaceMode === option.value && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </div>
              <span className="text-sm font-medium text-foreground">{option.label}</span>
            </div>
            <p className="text-xs text-muted-foreground ml-5">{option.desc}</p>
          </button>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground/60 mt-2">You can also switch from the sidebar footer.</p>
    </div>
  )
}

function LanguageSection() {
  const ts = useTranslations('settings')
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{ts('language')}</p>
          <p className="text-2xs text-muted-foreground mt-0.5">{ts('languageDescription')}</p>
        </div>
        <LanguageSwitcherSelect />
      </div>
    </div>
  )
}

/** Convert snake_case key to Title Case label */
function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Account OAuth Section — shows Google connection status with disconnect option
// ---------------------------------------------------------------------------

function AccountOAuthSection() {
  const { currentUser } = useMissionControl()
  const [disconnecting, setDisconnecting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  if (!currentUser) return null

  const isGoogleConnected = currentUser.provider === 'google'

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setFeedback({ ok: true, text: 'Google account disconnected. You can now sign in with username and password.' })
        // Reload after a short delay so the user sees the feedback
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setFeedback({ ok: false, text: data.error || 'Failed to disconnect' })
      }
    } catch {
      setFeedback({ ok: false, text: 'Network error' })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-2">
        <h3 className="text-sm font-medium text-foreground">Account</h3>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Google icon */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              isGoogleConnected ? 'bg-white' : 'bg-muted'
            }`}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Google</span>
                {isGoogleConnected ? (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Connected</span>
                ) : (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Not connected</span>
                )}
              </div>
              {isGoogleConnected && currentUser.email ? (
                <p className="text-xs text-muted-foreground mt-0.5">{currentUser.email}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">Link your Google account for OAuth sign-in</p>
              )}
            </div>
          </div>

          {isGoogleConnected && (
            <Button
              onClick={handleDisconnect}
              disabled={disconnecting}
              variant="outline"
              size="sm"
              className="text-xs hover:text-destructive hover:border-destructive/50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          )}
        </div>

        {feedback && (
          <div className={`mt-3 rounded-md p-2.5 text-xs font-medium ${
            feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
          }`}>
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  )
}
