'use client'

import { useState } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'

/** Radio-button group for switching between Essential and Full interface modes. */
export function InterfaceModeSelector() {
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
        signal: AbortSignal.timeout(8000),
      })
      // If switching to essential and on a hidden panel, redirect to overview
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
