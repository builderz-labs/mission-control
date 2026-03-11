'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'

interface ChecklistItem {
  id: string
  label: string
  checked: boolean
  panel?: string
}

export function OnboardingChecklistWidget() {
  const { agents, tasks, securityPosture, dashboardMode } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [visible, setVisible] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [celebrating, setCelebrating] = useState(false)

  const isGateway = dashboardMode === 'full'

  // Check if checklist should be visible
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const onboardingRes = await fetch('/api/onboarding')
        if (cancelled) return

        const onboardingData = onboardingRes.ok ? await onboardingRes.json() : null

        const completed = onboardingData?.completed === true
        const skipped = onboardingData?.skipped === true
        const isDismissed = onboardingData?.checklistDismissed === true

        if (completed && !skipped && !isDismissed) {
          setVisible(true)
        } else {
          setVisible(false)
        }
      } catch {
        // Don't show on error
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  // Derive checklist items from real data
  const items: ChecklistItem[] = [
    { id: 'account', label: 'Account created', checked: true },
    { id: 'interface', label: 'Interface mode selected', checked: true },
    { id: 'credentials', label: 'Credentials reviewed', checked: true },
    { id: 'security', label: 'Run security scan', checked: !!securityPosture, panel: 'settings' },
    { id: 'agent', label: 'Dock your first agent', checked: agents.length > 0, panel: 'agents' },
    { id: 'task', label: 'Create your first task', checked: tasks.length > 0, panel: 'tasks' },
  ]

  const completedCount = items.filter(i => i.checked).length
  const allComplete = completedCount === items.length
  const progressPct = Math.round((completedCount / items.length) * 100)

  // Auto-celebrate when all complete
  useEffect(() => {
    if (allComplete && visible && !celebrating) {
      setCelebrating(true)
      const timer = setTimeout(async () => {
        try {
          await fetch('/api/onboarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'dismiss_checklist' }),
          })
        } catch {}
        setVisible(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [allComplete, visible, celebrating])

  const handleDismiss = useCallback(async () => {
    setDismissing(true)
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss_checklist' }),
      })
      setVisible(false)
    } catch {
      // silently fail
    } finally {
      setDismissing(false)
    }
  }, [])

  if (!visible) return null

  const accentText = isGateway ? 'text-void-cyan' : 'text-void-amber'
  const accentBg = isGateway ? 'bg-void-cyan' : 'bg-void-amber'
  const accentBorder = isGateway ? 'border-void-cyan/30' : 'border-void-amber/30'

  if (celebrating) {
    return (
      <section className={`rounded-xl border ${accentBorder} bg-card p-6 text-center`}>
        <div className={`text-xl font-bold mb-1 ${accentText}`}>Station Fully Operational</div>
        <p className="text-sm text-muted-foreground">All systems online. You&apos;re ready to go.</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Setup Progress ({completedCount}/{items.length})</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-2xs text-muted-foreground h-6 px-2"
          disabled={dismissing}
          onClick={handleDismiss}
        >
          Dismiss
        </Button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-surface-2 rounded-full mb-4 overflow-hidden">
        <div
          className={`h-full ${accentBg} rounded-full transition-all duration-500`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Checklist */}
      <div className="space-y-1.5">
        {items.map(item => (
          <div
            key={item.id}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
              item.checked ? 'text-muted-foreground/60' : 'text-foreground'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`font-mono text-xs ${item.checked ? 'text-green-400' : 'text-muted-foreground/40'}`}>
                [{item.checked ? 'x' : ' '}]
              </span>
              <span className={item.checked ? 'line-through' : ''}>{item.label}</span>
            </div>
            {!item.checked && item.panel && (
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs h-6 px-2 ${accentText}`}
                onClick={() => navigateToPanel(item.panel!)}
              >
                {'->'}
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
