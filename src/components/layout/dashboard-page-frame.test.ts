import { describe, expect, it } from 'vitest'
import { dashboardPageLayout, usesConversationShell } from './dashboard-page-frame'

describe('dashboardPageLayout', () => {
  it('gives chat and Jev an independently scrolling, distraction-free shell', () => {
    expect(usesConversationShell('chat')).toBe(true)
    expect(usesConversationShell('jev')).toBe(true)
    expect(usesConversationShell('overview')).toBe(false)
    expect(usesConversationShell('')).toBe(false)
  })
  it.each([
    'chat',
    'gateway-config',
    'jev',
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
