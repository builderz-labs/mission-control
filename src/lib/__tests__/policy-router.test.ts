import { describe, expect, it } from 'vitest'
import { routePolicy } from '@/lib/policy-router'

describe('routePolicy', () => {
  it('rejects local-only tasks when a cloud agent is requested', async () => {
    const decision = await routePolicy({
      taskId: 'task-local-only',
      title: 'Review private note',
      description: 'Summarize local notes',
      tags: ['private'],
      metadata: { privacyClass: 'local_only' },
      budget: { maxUsd: 1 },
      tools: ['repo.read'],
      requestedAgent: 'cloud-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'reject',
      reason: 'local_only tasks cannot be routed to cloud agents.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    })
  })

  it('classifies sensitive security keywords as local-only before cloud routing', async () => {
    const decision = await routePolicy({
      taskId: 'task-token',
      title: 'API token leaked in logs',
      description: 'Inspect the exposed secret and rotate it',
      tags: ['security'],
      metadata: {},
      budget: { maxUsd: 1 },
      tools: ['repo.read'],
      requestedAgent: 'cloud-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'reject',
      reason: 'local_only tasks cannot be routed to cloud agents.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    })
  })

  it('downgrades cloud-ok tasks with PII to the local preferred agent', async () => {
    const decision = await routePolicy({
      taskId: 'task-pii',
      title: 'Draft customer response',
      description: 'Reply to alex@example.com about the incident',
      tags: ['support'],
      metadata: { privacyClass: 'cloud_ok', localPreferredAgent: 'local-codex' },
      budget: { maxUsd: 1 },
      tools: ['repo.read'],
      requestedAgent: 'cloud-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'allow',
      target: 'local-codex',
      reason: 'PII detected in cloud-ok task; routing to local preferred agent.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    })
  })

  it('rejects tasks when estimated cost exceeds the task cap', async () => {
    const decision = await routePolicy({
      taskId: 'task-budget',
      title: 'Run broad research',
      description: 'Compare options',
      tags: ['research'],
      metadata: {},
      budget: { maxUsd: 0.25, estimatedUsd: 0.75 },
      tools: ['web.search'],
      requestedAgent: 'local-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'reject',
      reason: 'Estimated task cost exceeds the configured budget cap.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    })
  })

  it('requires approval for destructive tools before dispatch', async () => {
    const decision = await routePolicy({
      taskId: 'task-shell',
      title: 'Restart service',
      description: 'Run a shell command that changes system state',
      tags: ['ops'],
      metadata: {},
      budget: { maxUsd: 1 },
      tools: ['shell.exec'],
      requestedAgent: 'local-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'approval_required',
      reason: 'Side-effecting tools require explicit approval before dispatch.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    })
  })

  it('allows low-risk local tasks by default', async () => {
    const decision = await routePolicy({
      taskId: 'task-local',
      title: 'Update dashboard copy',
      description: 'Small local UI text change',
      tags: ['frontend'],
      metadata: {},
      budget: { maxUsd: 0.5 },
      tools: ['repo.read'],
      requestedAgent: 'local-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toEqual({
      action: 'allow',
      target: 'local-codex',
      reason: 'Task stays within local execution policy.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'info',
      },
    })
  })

  it('requires approval before routing cloud tasks that can write code', async () => {
    const decision = await routePolicy({
      taskId: 'task-cloud',
      title: 'Implement API change',
      description: 'Delegate implementation to a hosted coding agent',
      tags: ['backend'],
      metadata: {},
      budget: { maxUsd: 5 },
      tools: ['repo.write'],
      requestedAgent: 'cloud-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'approval_required',
      target: 'cloud-codex',
      reason: 'Cloud write-capable delegation requires explicit approval.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    })
  })

  it('rejects tasks that request secret access without an approved secret scope', async () => {
    const decision = await routePolicy({
      taskId: 'task-secret',
      title: 'Debug production token',
      description: 'Investigate a leaked API key',
      tags: ['security'],
      metadata: {},
      budget: { maxUsd: 1 },
      tools: ['secrets.read'],
      requestedAgent: 'local-codex',
      workspaceId: 'workspace-main',
    })

    expect(decision).toMatchObject({
      action: 'reject',
      reason: 'Secret access is blocked unless an approved secret scope is present.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    })
  })
})
