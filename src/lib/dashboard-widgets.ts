import { WIDGET_CATALOG, type DashboardWidget } from './dashboard-widget-catalog'

export { WIDGET_CATALOG }
export type { DashboardWidget }

// The terminal wall already lists every live CLI session, so the older
// session-workbench card would be a second surface for the same thing.
export const LOCAL_DEFAULT_LAYOUT = [
  'briefing-bar',
  'session-terminal',
  'activity-timeline',
  'fleet-status',
  'task-pipeline',
  'system-health',
  'quick-actions',
]

export const GATEWAY_DEFAULT_LAYOUT = [
  'briefing-bar',
  'session-terminal',
  'activity-timeline',
  'fleet-status',
  'task-pipeline',
  'system-health',
  'quick-actions',
]

export function getDefaultLayout(mode: 'local' | 'full'): string[] {
  return mode === 'local' ? LOCAL_DEFAULT_LAYOUT : GATEWAY_DEFAULT_LAYOUT
}

// Layouts that used to ship as the default. A stored layout that still matches
// one of these was never customised, so it is re-seeded from the current default
// instead of freezing that user out of newly added widgets.
const SUPERSEDED_DEFAULT_LAYOUTS = [
  [
    'briefing-bar',
    'activity-timeline',
    'fleet-status',
    'task-pipeline',
    'system-health',
    'quick-actions',
  ],
  [
    'briefing-bar',
    'session-workbench',
    'activity-timeline',
    'fleet-status',
    'task-pipeline',
    'system-health',
    'quick-actions',
  ],
  [
    'briefing-bar',
    'session-terminal',
    'session-workbench',
    'activity-timeline',
    'fleet-status',
    'task-pipeline',
    'system-health',
    'quick-actions',
  ],
]

function isSupersededDefault(stored: string[]): boolean {
  return SUPERSEDED_DEFAULT_LAYOUTS.some(
    (layout) => layout.length === stored.length && layout.every((id, index) => id === stored[index]),
  )
}

export function resolveDashboardLayout(stored: string[] | null, mode: 'local' | 'full'): string[] {
  const defaults = getDefaultLayout(mode)
  if (!stored) return defaults
  return isSupersededDefault(stored) ? defaults : stored
}

export function getWidgetById(id: string): DashboardWidget | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id)
}

export function getAvailableWidgets(mode: 'local' | 'full'): DashboardWidget[] {
  return WIDGET_CATALOG.filter((w) => w.modes.includes(mode))
}
