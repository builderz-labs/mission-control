'use client'

import { useState, useCallback, useRef } from 'react'
import { useMissionControl } from '@/store'
import { WIDGET_CATALOG, getDefaultLayout, getAvailableWidgets, getWidgetById } from '@/lib/dashboard-widgets'
import { Button } from '@/components/ui/button'
import type { DashboardData } from './widget-primitives'

import { MetricCardsWidget } from './widgets/metric-cards-widget'
import { RuntimeHealthWidget } from './widgets/runtime-health-widget'
import { GatewayHealthWidget } from './widgets/gateway-health-widget'
import { SessionWorkbenchWidget } from './widgets/session-workbench-widget'
import { EventStreamWidget } from './widgets/event-stream-widget'
import { TaskFlowWidget } from './widgets/task-flow-widget'
import { GithubSignalWidget } from './widgets/github-signal-widget'
import { SecurityAuditWidget } from './widgets/security-audit-widget'
import { MaintenanceWidget } from './widgets/maintenance-widget'
import { QuickActionsWidget } from './widgets/quick-actions-widget'

const WIDGET_COMPONENTS: Record<string, React.ComponentType<{ data: DashboardData }>> = {
  'metric-cards': MetricCardsWidget,
  'runtime-health': RuntimeHealthWidget,
  'gateway-health': GatewayHealthWidget,
  'session-workbench': SessionWorkbenchWidget,
  'event-stream': EventStreamWidget,
  'task-flow': TaskFlowWidget,
  'github-signal': GithubSignalWidget,
  'security-audit': SecurityAuditWidget,
  'maintenance': MaintenanceWidget,
  'quick-actions': QuickActionsWidget,
}

// Map widget defaultSize to CSS grid column spans
const SIZE_CLASSES: Record<string, string> = {
  sm: 'xl:col-span-6',
  md: 'xl:col-span-4',
  lg: 'xl:col-span-8',
  full: 'xl:col-span-12',
}

export function WidgetGrid({ data }: { data: DashboardData }) {
  const { dashboardLayout, setDashboardLayout, dashboardMode } = useMissionControl()
  const mode = dashboardMode === 'local' ? 'local' : 'full'
  const [customizing, setCustomizing] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragCounter = useRef(0)

  const defaults = getDefaultLayout(mode)
  const activeLayout = dashboardLayout ?? defaults
  const available = getAvailableWidgets(mode)

  // Filter layout to only include widgets valid for current mode
  const validLayout = activeLayout.filter((id) => {
    const w = getWidgetById(id)
    return w && w.modes.includes(mode)
  })

  // Widgets not in current layout but available for this mode
  const hiddenWidgets = available.filter((w) => !validLayout.includes(w.id))

  const handleDragStart = useCallback((e: React.DragEvent, widgetId: string) => {
    setDragId(widgetId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', widgetId)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDragEnter = useCallback((_e: React.DragEvent, widgetId: string) => {
    dragCounter.current++
    setDragOverId(widgetId)
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCounter.current--
    if (dragCounter.current <= 0) {
      setDragOverId(null)
      dragCounter.current = 0
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOverId(null)
    setDragId(null)

    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) return

    const newLayout = [...validLayout]
    const sourceIdx = newLayout.indexOf(sourceId)
    const targetIdx = newLayout.indexOf(targetId)

    if (sourceIdx === -1) {
      // Adding from hidden widgets — insert at target position
      newLayout.splice(targetIdx + 1, 0, sourceId)
    } else if (targetIdx === -1) {
      return
    } else {
      // Reorder
      newLayout.splice(sourceIdx, 1)
      newLayout.splice(targetIdx, 0, sourceId)
    }

    setDashboardLayout(newLayout)
  }, [validLayout, setDashboardLayout])

  const handleDragEnd = useCallback(() => {
    setDragId(null)
    setDragOverId(null)
    dragCounter.current = 0
  }, [])

  const addWidget = useCallback((widgetId: string) => {
    const newLayout = [...validLayout, widgetId]
    setDashboardLayout(newLayout)
  }, [validLayout, setDashboardLayout])

  const removeWidget = useCallback((widgetId: string) => {
    const newLayout = validLayout.filter((id) => id !== widgetId)
    setDashboardLayout(newLayout)
  }, [validLayout, setDashboardLayout])

  const resetToDefaults = useCallback(() => {
    setDashboardLayout(null)
  }, [setDashboardLayout])

  // Group widgets into rows based on their sizes
  // full-width widgets get their own row; sm/md/lg widgets flow in a 12-col grid
  const renderWidgets = () => {
    const elements: React.ReactNode[] = []
    let rowWidgets: { id: string; size: string }[] = []
    let rowSpan = 0

    const flushRow = () => {
      if (rowWidgets.length === 0) return
      elements.push(
        <section key={`row-${elements.length}`} className="grid xl:grid-cols-12 gap-4">
          {rowWidgets.map(({ id, size }) => renderWidget(id, SIZE_CLASSES[size] || 'xl:col-span-4'))}
        </section>
      )
      rowWidgets = []
      rowSpan = 0
    }

    for (const widgetId of validLayout) {
      const widget = getWidgetById(widgetId)
      if (!widget) continue

      const Component = WIDGET_COMPONENTS[widgetId]
      if (!Component) continue

      if (widget.defaultSize === 'full') {
        flushRow()
        elements.push(renderWidget(widgetId, ''))
      } else {
        const span = widget.defaultSize === 'sm' ? 6 : widget.defaultSize === 'md' ? 4 : 8
        if (rowSpan + span > 12) flushRow()
        rowWidgets.push({ id: widgetId, size: widget.defaultSize })
        rowSpan += span
      }
    }
    flushRow()

    return elements
  }

  const renderWidget = (widgetId: string, colClass: string) => {
    const Component = WIDGET_COMPONENTS[widgetId]
    const widget = getWidgetById(widgetId)
    if (!Component || !widget) return null

    const isDragging = dragId === widgetId
    const isDragOver = dragOverId === widgetId

    return (
      <div
        key={widgetId}
        className={`${colClass} relative ${customizing ? 'cursor-grab' : ''} ${
          isDragging ? 'opacity-40' : ''
        } ${isDragOver ? 'ring-2 ring-primary/50 rounded-lg' : ''}`}
        draggable={customizing}
        onDragStart={(e) => handleDragStart(e, widgetId)}
        onDragOver={handleDragOver}
        onDragEnter={(e) => handleDragEnter(e, widgetId)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, widgetId)}
        onDragEnd={handleDragEnd}
      >
        {customizing && (
          <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
            <span className="text-2xs text-muted-foreground bg-card/80 backdrop-blur-sm rounded px-1.5 py-0.5 border border-border/50 cursor-grab">
              :::
            </span>
            <button
              type="button"
              onClick={() => removeWidget(widgetId)}
              className="text-2xs text-red-400 hover:text-red-300 bg-card/80 backdrop-blur-sm rounded px-1.5 py-0.5 border border-border/50"
            >
              x
            </button>
          </div>
        )}
        <Component data={data} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {renderWidgets()}

      {/* Customize mode: hidden widgets + controls */}
      {customizing && hiddenWidgets.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Available Widgets</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {hiddenWidgets.map((widget) => (
              <button
                key={widget.id}
                type="button"
                onClick={() => addWidget(widget.id)}
                className="rounded-lg border border-dashed border-border/60 p-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-smooth"
              >
                <div className="text-xs font-medium text-foreground/70">{widget.label}</div>
                <div className="text-2xs text-muted-foreground mt-0.5">{widget.description}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Customize controls bar */}
      <div className="flex items-center justify-end gap-2">
        {customizing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetToDefaults}
            className="text-2xs h-7"
          >
            Reset to Defaults
          </Button>
        )}
        <Button
          variant={customizing ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCustomizing(!customizing)}
          className="text-2xs h-7"
        >
          {customizing ? 'Done' : 'Customize'}
        </Button>
      </div>
    </div>
  )
}
