'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { normalizeSchema } from '@/lib/config-schema-utils'
import { useGatewayConfig } from './gateway-config/use-gateway-config'
import { useGatewayActions } from './gateway-config/use-gateway-actions'
import { ConfigSidebar } from './gateway-config/config-sidebar'
import { SectionCard } from './gateway-config/section-card'
import { SECTION_META } from './gateway-config/gateway-config-types'
import { humanize, truncateValue, deepSet } from './gateway-config/schema-utils'

export function GatewayConfigPanel() {
  const t = useTranslations('gatewayConfig')
  const {
    config, configPath, configHash, schema, schemaLoading, loading, error,
    jsonText, sections, filteredSections, diff, hasChanges,
    setConfig, setConfigHash, setJsonText, fetchConfig, fetchSchema,
    searchQuery, setSearchQuery, mode, setMode,
  } = useGatewayConfig()

  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }, [])

  const showFeedback = useCallback((ok: boolean, text: string) => {
    setFeedback({ ok, text })
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 4000)
  }, [])

  const handlePatch = useCallback((path: string[], value: unknown) => {
    setConfig(prev => prev ? deepSet(prev, path, value) : prev)
  }, [setConfig])

  const { handleSave, handleApply, handleUpdate } = useGatewayActions({
    hasChanges, saving, applying, updating, mode, jsonText, diff, configHash,
    showFeedback, fetchConfig, setSaving, setApplying, setUpdating, setConfigHash,
  })

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
        <p className="text-xs text-muted-foreground mt-2">{t('configPathHint')}</p>
      </div>
    )
  }

  const visibleSections = activeSection ? [activeSection] : filteredSections

  return (
    <div className="flex h-full">
      <ConfigSidebar
        configPath={configPath} sections={sections} filteredSections={filteredSections}
        activeSection={activeSection} searchQuery={searchQuery} mode={mode}
        sidebarTitle={t('sidebarTitle')} searchPlaceholder={t('searchPlaceholder')}
        allSettingsLabel={t('allSettings')} modeFormLabel={t('modeForm')} modeJsonLabel={t('modeJson')}
        config={config} currentJsonText={jsonText}
        onSetActiveSection={setActiveSection} onSearchChange={setSearchQuery} onModeChange={setMode}
        onSyncJsonToForm={text => { try { setConfig(() => JSON.parse(text)) } catch { /* keep */ } }}
        onSyncFormToJson={json => setJsonText(json)}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <ActionBar
          hasChanges={hasChanges} saving={saving} applying={applying} updating={updating}
          mode={mode} diffCount={diff.length} loading={loading}
          t={t} onReload={() => { fetchConfig(); fetchSchema() }}
          onSave={handleSave} onApply={handleApply} onUpdate={handleUpdate}
        />

        {feedback && (
          <div className={`mx-4 mt-2 rounded-lg p-2.5 text-xs font-medium ${feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'}`}>
            {feedback.text}
          </div>
        )}

        {hasChanges && mode === 'form' && diff.length > 0 && (
          <details className="mx-4 mt-2 border border-amber-500/20 rounded-lg">
            <summary className="px-3 py-1.5 text-xs text-amber-400 cursor-pointer hover:bg-amber-500/5">
              {t('viewPendingChanges', { count: diff.length })}
            </summary>
            <div className="px-3 py-2 space-y-1 border-t border-amber-500/10">
              {diff.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-2xs">
                  <span className="font-mono text-muted-foreground">{d.path}</span>
                  <span className="text-red-400 truncate max-w-24">{truncateValue(d.from)}</span>
                  <span className="text-muted-foreground">-&gt;</span>
                  <span className="text-green-400 truncate max-w-24">{truncateValue(d.to)}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {mode === 'json' ? (
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              className="w-full h-full min-h-[500px] p-3 text-xs font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
              spellCheck={false}
            />
          ) : (
            <>
              {schemaLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  {t('loadingSchema')}
                </div>
              )}
              {config && visibleSections.map(sectionKey => {
                const sectionSchema = schema?.properties?.[sectionKey]
                const sectionValue = config[sectionKey]
                if (sectionValue === undefined && !sectionSchema) return null
                const meta = SECTION_META[sectionKey] ?? { label: humanize(sectionKey), icon: sectionKey[0].toUpperCase() }
                return (
                  <SectionCard
                    key={sectionKey}
                    sectionKey={sectionKey}
                    label={meta.label}
                    icon={meta.icon}
                    description={sectionSchema ? normalizeSchema(sectionSchema).description : undefined}
                    schema={sectionSchema ? normalizeSchema(sectionSchema) : undefined}
                    value={sectionValue}
                    searchQuery={searchQuery}
                    onPatch={(path, value) => handlePatch([sectionKey, ...path], value)}
                  />
                )
              })}
              {visibleSections.length === 0 && (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {t('noSettingsMatch', { query: searchQuery })}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Action Bar ─────────────────────────────────────────────────────────────

function ActionBar({ hasChanges, saving, applying, updating, mode, diffCount, loading, t, onReload, onSave, onApply, onUpdate }: {
  hasChanges: boolean; saving: boolean; applying: boolean; updating: boolean
  mode: string; diffCount: number; loading: boolean
  t: ReturnType<typeof useTranslations>
  onReload: () => void; onSave: () => void; onApply: () => void; onUpdate: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/30">
      <div className="flex items-center gap-2">
        {hasChanges ? (
          <span className="text-xs font-medium text-amber-400">
            {mode === 'json' ? t('unsavedChanges') : t('unsavedChangesCount', { count: diffCount })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('noChanges')}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={onReload} disabled={loading}>{t('reload')}</Button>
        <Button variant="default" size="xs" onClick={onSave} disabled={!hasChanges || saving}>{saving ? t('saving') : t('save')}</Button>
        <Button variant="outline" size="xs" onClick={onApply} disabled={applying}>{applying ? t('applying') : t('apply')}</Button>
        <Button variant="outline" size="xs" onClick={onUpdate} disabled={updating}>{updating ? t('updating') : t('updateSystem')}</Button>
      </div>
    </div>
  )
}
