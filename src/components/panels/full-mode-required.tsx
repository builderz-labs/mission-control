'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { useNavigateToPanel } from '@/lib/navigation'
import { useMissionControl } from '@/store'

interface FullModeRequiredProps {
  panelId: string
}

function formatPanelName(panelId: string): string {
  return panelId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function FullModeRequired({ panelId }: FullModeRequiredProps) {
  const t = useTranslations('page')
  const navigateToPanel = useNavigateToPanel()
  const setInterfaceMode = useMissionControl((state) => state.setInterfaceMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelName = formatPanelName(panelId)

  async function enableFullMode() {
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }),
      })
      setInterfaceMode('full')
    } catch {
      setError('Could not save Full mode. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 px-5 py-24 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{panelName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('availableInFullMode', { panel: panelName })}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={saving} onClick={() => void enableFullMode()}>
          {saving ? 'Switching…' : t('switchToFull')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigateToPanel('overview')}>
          {t('goToOverview')}
        </Button>
      </div>
    </section>
  )
}
