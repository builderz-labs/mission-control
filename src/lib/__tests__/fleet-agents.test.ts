import { describe, expect, it } from 'vitest'
import {
  asFleetAgentName,
  canonicalFleetAgentName,
  fleetAgentFromWorkspace,
  fleetAgentsShareIdentity,
  FLEET_AGENT_NAMES,
  isFleetAgentName,
} from '@/lib/fleet-agents'

describe('fleet agents', () => {
  it('lists claude-1 and claude-2 instead of the old 20x/5x display names', () => {
    expect(FLEET_AGENT_NAMES).toEqual(['claude-1', 'claude-2', 'codex', 'grok', 'kimi'])
    expect(isFleetAgentName('claude-1')).toBe(true)
    expect(isFleetAgentName('claude-20x')).toBe(false)
  })

  it('canonicalizes leftover 20x/5x aliases onto isolated seats', () => {
    expect(canonicalFleetAgentName('claude-20x')).toBe('claude-1')
    expect(canonicalFleetAgentName('claude-5x')).toBe('claude-2')
    expect(asFleetAgentName('claude')).toBeNull()
    expect(fleetAgentsShareIdentity('claude-1', 'claude-20x')).toBe(true)
    expect(fleetAgentsShareIdentity('claude-1', 'claude-2')).toBe(false)
  })

  it('maps workspaces and account dirs without treating 20x as claude-2', () => {
    expect(fleetAgentFromWorkspace('/x/workspace-claude-20x')).toBe('claude-1')
    expect(fleetAgentFromWorkspace('/x/workspace-claude-5x')).toBe('claude-2')
    expect(fleetAgentFromWorkspace('/x/.claude-account2/projects')).toBe('claude-2')
    expect(fleetAgentFromWorkspace('~/Dev/actz-may')).toBe('claude-1')
  })
})
