import { describe, expect, it } from 'vitest'
import { resolveCoordinatorDeliveryTarget, type CoordinatorAgentRecord } from '@/lib/coordinator-routing'
import type { GatewaySession } from '@/lib/sessions'

function mkSession(agent: string, key: string): GatewaySession {
  return {
    key,
    agent,
    sessionId: `${agent}-session`,
    updatedAt: Date.now(),
    chatType: 'direct',
    channel: 'test',
    model: 'test-model',
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    active: true,
  }
}

describe('resolveCoordinatorDeliveryTarget', () => {
  it('returns direct resolution when target agent exists', () => {
    const directAgent: CoordinatorAgentRecord = {
      name: 'dev',
      session_key: 'agent:dev:main',
      config: JSON.stringify({ openclawId: 'dev' }),
    }

    const resolved = resolveCoordinatorDeliveryTarget({
      to: 'dev',
      coordinatorAgent: 'Coordinator',
      directAgent,
      allAgents: [],
      sessions: [mkSession('dev', 'agent:dev:main')],
    })

    expect(resolved).toEqual({
      deliveryName: 'dev',
      sessionKey: 'agent:dev:main',
      openclawAgentId: 'dev',
      resolvedBy: 'direct',
    })
  })

  it('resolves coordinator to explicitly configured target when present', () => {
    const allAgents: CoordinatorAgentRecord[] = [
      { name: 'jarv', config: JSON.stringify({ openclawId: 'jarv' }) },
      { name: 'dev', config: JSON.stringify({ isDefault: true, openclawId: 'dev' }) },
    ]

    const resolved = resolveCoordinatorDeliveryTarget({
      to: 'Coordinator',
      coordinatorAgent: 'Coordinator',
      directAgent: null,
      allAgents,
      sessions: [mkSession('jarv', 'agent:jarv:main')],
      configuredCoordinatorTarget: 'jarv',
    })

    expect(resolved).toEqual({
      deliveryName: 'jarv',
      sessionKey: 'agent:jarv:main',
      openclawAgentId: 'jarv',
      resolvedBy: 'configured',
    })
  })

  it('resolves coordinator to default agent when no explicit target is configured', () => {
    const allAgents: CoordinatorAgentRecord[] = [
      { name: 'jarv', config: JSON.stringify({ openclawId: 'jarv' }) },
      { name: 'dev', config: JSON.stringify({ isDefault: true, openclawId: 'dev' }) },
    ]

    const resolved = resolveCoordinatorDeliveryTarget({
      to: 'Coordinator',
      coordinatorAgent: 'Coordinator',
      directAgent: null,
      allAgents,
      sessions: [mkSession('dev', 'agent:dev:main')],
    })

    expect(resolved).toEqual({
      deliveryName: 'dev',
      sessionKey: 'agent:dev:main',
      openclawAgentId: 'dev',
      resolvedBy: 'default',
    })
  })

  it('resolves coordinator to first live main session when no default agent exists', () => {
    const resolved = resolveCoordinatorDeliveryTarget({
      to: 'Coordinator',
      coordinatorAgent: 'Coordinator',
      directAgent: null,
      allAgents: [{ name: 'admin', config: JSON.stringify({ openclawId: 'admin' }) }],
      sessions: [mkSession('jarv', 'agent:jarv:main')],
    })

    expect(resolved).toEqual({
      deliveryName: 'jarv',
      sessionKey: 'agent:jarv:main',
      openclawAgentId: 'jarv',
      resolvedBy: 'main_session',
    })
  })

  it('falls back to normalized destination when nothing else matches', () => {
    const resolved = resolveCoordinatorDeliveryTarget({
      to: 'Coordinator Team',
      coordinatorAgent: 'Coordinator',
      directAgent: null,
      allAgents: [],
      sessions: [],
    })

    expect(resolved).toEqual({
      deliveryName: 'Coordinator Team',
      sessionKey: null,
      openclawAgentId: 'coordinator-team',
      resolvedBy: 'fallback',
    })
  })
})
