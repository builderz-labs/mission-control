import type { ReactNode } from 'react'

export type DashboardPageLayout = 'standard' | 'wide' | 'workspace'

const WORKSPACE_PANELS = new Set([
  'chat',
  'gateway-config',
  'knowledge-graph',
  'logs',
  'memory',
  'notifications',
  'office',
  'standup',
  'tasks',
])

const WIDE_PANELS = new Set([
  'agents',
  'channels',
  'cron',
  'fly',
  'overview',
  'skills',
  'super-admin',
])

export function dashboardPageLayout(panelId: string): DashboardPageLayout {
  if (WORKSPACE_PANELS.has(panelId)) return 'workspace'
  if (WIDE_PANELS.has(panelId)) return 'wide'
  return 'standard'
}

function panelLabel(panelId: string): string {
  return panelId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function DashboardPageFrame({
  panelId,
  children,
}: {
  panelId: string
  children: ReactNode
}) {
  const layout = dashboardPageLayout(panelId)
  const layoutClass = layout === 'workspace'
    ? 'h-full min-h-0 overflow-hidden'
    : layout === 'wide'
      ? 'min-h-full max-w-[96rem]'
      : 'min-h-full max-w-[80rem]'

  return (
    <section
      aria-label={`${panelLabel(panelId)} page`}
      data-dashboard-page={panelId}
      data-dashboard-layout={layout}
      className={`relative mx-auto w-full min-w-0 ${layoutClass}`}
    >
      {children}
    </section>
  )
}
