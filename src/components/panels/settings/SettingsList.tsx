'use client'

import { Button } from '@/components/ui/button'
import {
  type Setting,
  type CoordinatorTargetAgent,
  type CoordinatorSession,
  subscriptionDropdowns,
  formatLabel,
  getCoordinatorResolutionPreview,
  COORDINATOR_AGENT,
} from './settings-types'

interface SettingsListProps {
  settings: Setting[]
  activeCategory: string
  edits: Record<string, string>
  coordinatorTargetAgents: CoordinatorTargetAgent[]
  coordinatorSessions: CoordinatorSession[]
  onEdit: (key: string, value: string) => void
  onReset: (key: string) => void
}

export function SettingsList({
  settings,
  activeCategory,
  edits,
  coordinatorTargetAgents,
  coordinatorSessions,
  onEdit,
  onReset,
}: SettingsListProps) {
  // Build grouped map from flat settings array for the active category
  const categorySettings = settings.filter(s => s.category === activeCategory)

  return (
    <div className="space-y-3">
      {categorySettings.map(setting => {
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
          ? getCoordinatorResolutionPreview(currentValue, coordinatorTargetAgents, coordinatorSessions)
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
                      onChange={e => onEdit(setting.key, e.target.value)}
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
                      onClick={() => onEdit(setting.key, currentValue === 'true' ? 'false' : 'true')}
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
                      onChange={e => onEdit(setting.key, e.target.value)}
                      className="w-24 px-2 py-1 text-sm text-right bg-background border border-border rounded-md focus:border-primary focus:outline-none font-mono"
                    />
                  ) : (
                    <input
                      type="text"
                      value={currentValue}
                      onChange={e => onEdit(setting.key, e.target.value)}
                      className="w-48 px-2 py-1 text-sm bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                    />
                  )}

                  {!setting.is_default && (
                    <Button
                      onClick={() => onReset(setting.key)}
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
  )
}
