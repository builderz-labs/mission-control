import { describe, expect, it } from 'vitest'
import {
  countOfficeAgents,
  filterOfficeAgents,
  getOfficeDisplayStatus,
  getOfficeNeedsAttention,
  getOfficeRosterLabel,
  isRunningOfficeAgent,
  type OfficeAgentLike,
} from '@/lib/office-agent-presence'

function makeAgent(status: OfficeAgentLike['status'], active?: boolean): OfficeAgentLike {
  return {
    status,
    config: active === undefined ? {} : { localSession: { active } },
  }
}

describe('office-agent-presence', () => {
  it('treats local session active flag as the running source of truth', () => {
    expect(isRunningOfficeAgent(makeAgent('idle', true))).toBe(true)
    expect(isRunningOfficeAgent(makeAgent('busy', false))).toBe(false)
  })

  it('falls back to non-offline for agents without local session metadata', () => {
    expect(isRunningOfficeAgent(makeAgent('busy'))).toBe(true)
    expect(isRunningOfficeAgent(makeAgent('idle'))).toBe(true)
    expect(isRunningOfficeAgent(makeAgent('offline'))).toBe(false)
  })

  it('filters running and not-running agents consistently in local mode', () => {
    const agents = [
      makeAgent('busy', true),
      makeAgent('idle', false),
      makeAgent('offline'),
    ]

    expect(filterOfficeAgents(agents, true, 'running')).toHaveLength(1)
    expect(filterOfficeAgents(agents, true, 'not-running')).toHaveLength(2)
  })

  it('returns explicit offline and not-running roster labels', () => {
    expect(
      getOfficeRosterLabel({
        agent: makeAgent('offline'),
        hasRecentPresence: true,
        minutesIdle: 42,
      }).key,
    ).toBe('offlineStatus')

    expect(
      getOfficeRosterLabel({
        agent: makeAgent('idle', false),
        hasRecentPresence: true,
        minutesIdle: 42,
      }).key,
    ).toBe('notRunningStatus')
  })

  it('normalizes not-running local sessions away from active display states', () => {
    expect(getOfficeDisplayStatus(makeAgent('idle', false))).toBe('offline')
    expect(getOfficeDisplayStatus(makeAgent('busy', false))).toBe('offline')
    expect(getOfficeDisplayStatus(makeAgent('error', false))).toBe('error')
    expect(getOfficeDisplayStatus(makeAgent('busy', true))).toBe('busy')
  })

  it('counts agents by normalized display status', () => {
    expect(
      countOfficeAgents([
        makeAgent('busy', true),
        makeAgent('idle', false),
        makeAgent('error', false),
        makeAgent('offline'),
      ]),
    ).toEqual({
      idle: 0,
      busy: 1,
      error: 1,
      offline: 2,
    })
  })

  it('only flags attention for normalized idle agents in local mode', () => {
    expect(
      getOfficeNeedsAttention({
        agent: makeAgent('idle', true),
        hasRecentPresence: true,
        minutesIdle: 20,
        isLocalMode: true,
      }),
    ).toBe(true)

    expect(
      getOfficeNeedsAttention({
        agent: makeAgent('busy', false),
        hasRecentPresence: true,
        minutesIdle: 20,
        isLocalMode: true,
      }),
    ).toBe(false)

    expect(
      getOfficeNeedsAttention({
        agent: makeAgent('idle', true),
        hasRecentPresence: true,
        minutesIdle: 20,
        isLocalMode: false,
      }),
    ).toBe(false)
  })
})
