'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/types/sql'
import type { Agent } from './agent-detail-types'
import { ConfigModelSection } from './config-model-section'
import { ConfigSandboxSection } from './config-sandbox-section'
import { ConfigToolsSection } from './config-tools-section'
import { ConfigIdentitySection } from './config-identity-section'
import { ConfigWorkspaceSection } from './config-workspace-section'
import { ConfigSubagentsSection } from './config-subagents-section'

interface AgentConfig {
  model?: { primary?: string; fallbacks?: string[] }
  identity?: { name?: string; theme?: string; emoji?: string; content?: string; [key: string]: unknown }
  sandbox?: {
    mode?: string; sandboxMode?: string; sandbox_mode?: string
    workspaceAccess?: string; workspace_access?: string; workspace?: string
    docker?: { network?: string }; network?: string; dockerNetwork?: string; docker_network?: string
    [key: string]: unknown
  }
  tools?: { allow?: string[]; deny?: string[]; raw?: string; [key: string]: unknown }
  subagents?: { allowAgents?: string[]; model?: string; [key: string]: unknown }
  memorySearch?: { sources?: string[]; [key: string]: unknown }
  sandboxMode?: string; workspaceAccess?: string
  [key: string]: unknown
}

interface ConfigTabProps {
  agent: Agent
  workspaceFiles?: { identityMd: string; agentMd: string }
  onSaveWorkspaceFile?: (file: 'identity.md' | 'agent.md', content: string) => Promise<void>
  onSave: () => void
}

export function ConfigTab({ agent, workspaceFiles, onSaveWorkspaceFile, onSave }: ConfigTabProps) {
  const t = useTranslations('agentDetail')
  const [config, setConfig] = useState<AgentConfig>((agent.config as AgentConfig | undefined) || {})
  const [editing, setEditing] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [newFallbackModel, setNewFallbackModel] = useState('')
  const [newAllowTool, setNewAllowTool] = useState('')
  const [newDenyTool, setNewDenyTool] = useState('')
  const [identityMdInput, setIdentityMdInput] = useState('')
  const [agentMdInput, setAgentMdInput] = useState('')
  const [savingIdentityMd, setSavingIdentityMd] = useState(false)
  const [savingAgentMd, setSavingAgentMd] = useState(false)
  const [workspaceDocs, setWorkspaceDocs] = useState<Array<{ name: string; exists: boolean; content: string }>>([])
  const [loadingWorkspaceDocs, setLoadingWorkspaceDocs] = useState(false)

  useEffect(() => {
    setConfig((agent.config as AgentConfig | undefined) || {})
    setJsonInput(JSON.stringify(agent.config || {}, null, 2))
  }, [agent.config])

  useEffect(() => {
    setIdentityMdInput(String(workspaceFiles?.identityMd || ''))
    setAgentMdInput(String(workspaceFiles?.agentMd || ''))
  }, [workspaceFiles?.identityMd, workspaceFiles?.agentMd])

  useEffect(() => {
    const controller = new AbortController()
    const loadWorkspaceDocs = async () => {
      setLoadingWorkspaceDocs(true)
      try {
        const response = await fetch(`/api/agents/${agent.id}/files`, { signal: controller.signal })
        if (!response.ok) return
        const payload = await response.json()
        const entries = Object.entries(payload?.files || {}).map(([name, value]) => {
          const v = value as { exists?: unknown; content?: unknown } | null
          return { name, exists: Boolean(v?.exists), content: String(v?.content || '') }
        })
        setWorkspaceDocs(entries)
      } catch {
        setWorkspaceDocs([])
      } finally {
        setLoadingWorkspaceDocs(false)
      }
    }
    loadWorkspaceDocs()
    return () => controller.abort()
  }, [agent.id])

  useEffect(() => {
    const controller = new AbortController()
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models', { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: unknown) => String((model as { name?: string; alias?: string })?.name || (model as { name?: string; alias?: string })?.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Ignore model suggestions if unavailable
      }
    }
    loadAvailableModels()
    return () => controller.abort()
  }, [])

  const updateModelConfig = (updater: (current: { primary?: string; fallbacks?: string[] }) => { primary?: string; fallbacks?: string[] }) => {
    setConfig((prev) => {
      const nextModel = updater({ ...(prev?.model || {}) })
      const dedupedFallbacks = [...new Set((nextModel.fallbacks || []).map((value) => (value || '').trim()).filter(Boolean))]
      return { ...prev, model: { ...nextModel, fallbacks: dedupedFallbacks } }
    })
  }

  const addFallbackModel = () => {
    const trimmed = newFallbackModel.trim()
    if (!trimmed) return
    updateModelConfig((current) => ({ ...current, fallbacks: [...(current.fallbacks || []), trimmed] }))
    setNewFallbackModel('')
  }

  const updateIdentityField = (field: string, value: string) => {
    setConfig((prev) => ({ ...prev, identity: { ...(prev.identity || {}), [field]: value } }))
  }

  const updateSandboxField = (field: string, value: string) => {
    setConfig((prev) => ({ ...prev, sandbox: { ...(prev.sandbox || {}), [field]: value } }))
  }

  const addTool = (list: 'allow' | 'deny', value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setConfig((prev) => {
      const tools = prev.tools || {}
      const existing = Array.isArray(tools[list]) ? tools[list] : []
      if (existing.includes(trimmed)) return prev
      return { ...prev, tools: { ...tools, [list]: [...existing, trimmed] } }
    })
  }

  const removeTool = (list: 'allow' | 'deny', index: number) => {
    setConfig((prev) => {
      const tools = prev.tools || {}
      const existing = Array.isArray(tools[list]) ? [...tools[list]] : []
      existing.splice(index, 1)
      return { ...prev, tools: { ...tools, [list]: existing } }
    })
  }

  const saveWorkspaceFile = async (file: 'identity.md' | 'agent.md') => {
    if (!onSaveWorkspaceFile) return
    const content = file === 'identity.md' ? identityMdInput : agentMdInput
    if (file === 'identity.md') setSavingIdentityMd(true)
    else setSavingAgentMd(true)
    setError(null)
    try {
      await onSaveWorkspaceFile(file, content)
    } catch (err: unknown) {
      setError(getErrorMessage(err) || `Failed to save ${file}`)
    } finally {
      if (file === 'identity.md') setSavingIdentityMd(false)
      else setSavingAgentMd(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!showJson) {
        const primary = String(config?.model?.primary || '').trim()
        if (!primary) throw new Error('Primary model is required')
      }
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_config: showJson ? JSON.parse(jsonInput) : config,
          write_to_gateway: true,
        }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save')
      setEditing(false)
      onSave()
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const model = config.model || {}
  const identity = config.identity || {}
  const sandbox = config.sandbox || {}
  const tools = config.tools || {}
  const subagents = config.subagents || {}
  const memorySearch = config.memorySearch || {}
  const sandboxMode = sandbox.mode || sandbox.sandboxMode || sandbox.sandbox_mode || config.sandboxMode || 'not configured'
  const sandboxWorkspace = sandbox.workspaceAccess || sandbox.workspace_access || sandbox.workspace || config.workspaceAccess || 'not configured'
  const sandboxNetwork = sandbox?.docker?.network || sandbox.network || sandbox.dockerNetwork || sandbox.docker_network || 'none'
  const identityName = identity.name || agent.name || 'not configured'
  const identityTheme = identity.theme || agent.role || 'not configured'
  const identityEmoji = identity.emoji || '?'
  const identityPreview = identity.content || ''
  const toolAllow = Array.isArray(tools.allow) ? tools.allow : []
  const toolDeny = Array.isArray(tools.deny) ? tools.deny : []
  const toolRawPreview = typeof tools.raw === 'string' ? tools.raw : ''
  const modelPrimary = model.primary || ''
  const modelFallbacks = Array.isArray(model.fallbacks) ? model.fallbacks : []

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-medium text-foreground">{t('openclawConfig')}</h4>
        <div className="flex gap-2">
          <Button onClick={() => setShowJson(!showJson)} variant="secondary" size="xs">
            {showJson ? t('structured') : 'JSON'}
          </Button>
          {!editing && (
            <Button onClick={() => setEditing(true)} size="sm">Edit</Button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {Boolean(config.openclawId) && (
        <div className="text-xs text-muted-foreground">
          OpenClaw ID: <span className="font-mono text-foreground">{String(config.openclawId)}</span>
          {Boolean(config.isDefault) && <span className="ml-2 px-1.5 py-0.5 bg-primary/20 text-primary rounded text-xs">{t('default')}</span>}
        </div>
      )}

      {showJson ? (
        <div>
          {editing ? (
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              rows={20}
              className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          ) : (
            <pre className="bg-surface-1/30 rounded p-4 text-xs text-foreground/90 overflow-auto max-h-96 font-mono">
              {JSON.stringify(config, null, 2)}
            </pre>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <ConfigModelSection
            editing={editing}
            modelPrimary={modelPrimary}
            modelFallbacks={modelFallbacks}
            newFallbackModel={newFallbackModel}
            availableModels={availableModels}
            onPrimaryChange={(value) => updateModelConfig((current) => ({ ...current, primary: value }))}
            onFallbackChange={(index, value) => {
              const next = [...modelFallbacks]
              next[index] = value
              updateModelConfig((current) => ({ ...current, fallbacks: next }))
            }}
            onFallbackRemove={(index) => {
              const next = modelFallbacks.filter((_: string, i: number) => i !== index)
              updateModelConfig((current) => ({ ...current, fallbacks: next }))
            }}
            onNewFallbackChange={setNewFallbackModel}
            onAddFallback={addFallbackModel}
          />

          <ConfigIdentitySection
            editing={editing}
            identityEmoji={identityEmoji}
            identityName={identityName}
            identityTheme={identityTheme}
            identityPreview={identityPreview}
            identityName_raw={identity.name || ''}
            identityTheme_raw={identity.theme || ''}
            identityContent_raw={identity.content || ''}
            onFieldChange={updateIdentityField}
          />

          <ConfigWorkspaceSection
            editing={editing}
            identityMdInput={identityMdInput}
            agentMdInput={agentMdInput}
            savingIdentityMd={savingIdentityMd}
            savingAgentMd={savingAgentMd}
            loadingWorkspaceDocs={loadingWorkspaceDocs}
            workspaceDocs={workspaceDocs}
            onSaveWorkspaceFile={onSaveWorkspaceFile ? saveWorkspaceFile : undefined}
            onIdentityMdChange={setIdentityMdInput}
            onAgentMdChange={setAgentMdInput}
          />

          <ConfigSandboxSection
            editing={editing}
            sandbox={sandbox}
            sandboxMode={sandboxMode}
            sandboxWorkspace={sandboxWorkspace}
            sandboxNetwork={sandboxNetwork}
            onFieldChange={updateSandboxField}
          />

          <ConfigToolsSection
            editing={editing}
            toolAllow={toolAllow}
            toolDeny={toolDeny}
            toolRawPreview={toolRawPreview}
            newAllowTool={newAllowTool}
            newDenyTool={newDenyTool}
            onNewAllowChange={setNewAllowTool}
            onNewDenyChange={setNewDenyTool}
            onAddTool={addTool}
            onRemoveTool={removeTool}
          />

          <ConfigSubagentsSection
            editing={editing}
            subagents={subagents}
            availableModels={availableModels}
            onAddAgent={(agent) => {
              setConfig((prev) => {
                const sa = { ...(prev.subagents || {}) }
                const existing = Array.isArray(sa.allowAgents) ? sa.allowAgents : []
                if (existing.includes(agent)) return prev
                return { ...prev, subagents: { ...sa, allowAgents: [...existing, agent] } }
              })
            }}
            onRemoveAgent={(idx) => {
              setConfig((prev) => {
                const sa = { ...(prev.subagents || {}) }
                const list = [...(sa.allowAgents || [])]
                list.splice(idx, 1)
                return { ...prev, subagents: { ...sa, allowAgents: list } }
              })
            }}
            onModelChange={(model) => {
              setConfig((prev) => ({
                ...prev,
                subagents: { ...(prev.subagents || {}), model: model || undefined }
              }))
            }}
          />

          {memorySearch.sources && (
            <div className="bg-surface-1/50 rounded-lg p-4">
              <h5 className="text-sm font-medium text-foreground mb-2">{t('memorySearch')}</h5>
              <div className="flex gap-1">
                {memorySearch.sources.map((s: string) => (
                  <span key={s} className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? t('saving') : t('save')}
          </Button>
          <Button
            onClick={() => {
              setEditing(false)
              setConfig((agent.config as AgentConfig | undefined) || {})
              setJsonInput(JSON.stringify(agent.config || {}, null, 2))
            }}
            variant="secondary"
          >
            {t('cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
