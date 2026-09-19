import { describe, expect, it } from 'vitest'
import { dashboardPageLayout } from './dashboard-page-frame'

describe('dashboardPageLayout', () => {
  it.each([
    'chat',
    'gateway-config',
    'knowledge-graph',
    'logs',
    'memory',
    'notifications',
    'office',
    'standup',
    'tasks',
  ])('keeps %s as a full-height workspace', (panel) => {
    expect(dashboardPageLayout(panel)).toBe('workspace')
  })

  it.each([
    'agents',
    'channels',
    'cron',
    'fly',
    'overview',
    'skills',
    'super-admin',
  ])('gives %s the wide dashboard canvas', (panel) => {
    expect(dashboardPageLayout(panel)).toBe('wide')
  })

  it.each([
    'activity',
    'alerts',
    'audit',
    'cost-tracker',
    'debug',
    'exec-approvals',
    'gateways',
    'github',
    'integrations',
    'monitor',
    'nodes',
    'security',
    'settings',
    'users',
    'webhooks',
    'plugin-panel',
  ])('uses a readable standard canvas for %s', (panel) => {
    expect(dashboardPageLayout(panel)).toBe('standard')
  })
})
