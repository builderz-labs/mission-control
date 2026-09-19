import { describe, expect, it } from 'vitest'
import { matchFleetProject } from '@/lib/fleet-cwd'
import { claudeSeatsShareHistory, fleetAgentForSession, matchesSessionFilters, sessionEnvironment } from '@/lib/session-record'

describe('session records', () => {
  it('maps cwd under ~/Dev to a fleet project', () => {
    const home = process.env.HOME || ''
    const match = matchFleetProject(`${home}/Dev/actz-may/apps/web`)
    expect(match?.slug).toBe('actz-may')
    expect(matchFleetProject(`${home}/actz-may/src`)?.slug).toBe('actz-may')
    expect(matchFleetProject(`${home}/Dev/stillpoint-builders/stillpoint-builders`)?.slug).toBe(
      'stillpoint-builders',
    )
  })

  it('uses fleet identities, not leftover claude', () => {
    expect(fleetAgentForSession({ kind: 'claude-code', workingDir: '~/Dev/actz-may' })).toBe('claude-1')
    expect(fleetAgentForSession({ kind: 'codex-cli' })).toBe('codex')
    expect(fleetAgentForSession({ kind: 'grok' })).toBe('grok')
    expect(fleetAgentForSession({ kind: 'kimi' })).toBe('kimi')
    expect(fleetAgentForSession({ workingDir: '/x/workspace-claude-5x' })).toBe('claude-2')
    expect(fleetAgentForSession({ gatewayAgent: 'claude-20x' })).toBe('claude-1')
  })

  it('labels desktop Claude vs local vs gateway', () => {
    expect(sessionEnvironment({ source: 'gateway' })).toBe('gateway')
    expect(sessionEnvironment({ source: 'local', workingDir: '/Users/x/Library/Application Support/Claude/foo' })).toBe('desktop')
    expect(sessionEnvironment({ source: 'local', workingDir: '~/Dev/actz-may' })).toBe('local')
  })

  it('filters by agent project active and environment', () => {
    const session = {
      id: '1',
      key: 'actz-may',
      agent: 'codex',
      kind: 'codex-cli',
      project: 'actz-may',
      projectSlug: 'actz-may',
      environment: 'local' as const,
      age: '1m',
      model: 'codex',
      tokens: '0/0',
      channel: 'local',
      flags: [],
      active: false,
      startTime: 0,
      lastActivity: 1,
      source: 'local' as const,
      workingDir: '~/Dev/actz-may',
      lastUserPrompt: null,
    }
    expect(matchesSessionFilters(session, { agent: 'codex', project: 'actz-may' })).toBe(true)
    expect(matchesSessionFilters(session, { agent: 'grok' })).toBe(false)
    expect(matchesSessionFilters(session, { active: '1' })).toBe(false)
    expect(claudeSeatsShareHistory('claude-1', 'claude-20x')).toBe(true)
    expect(claudeSeatsShareHistory('claude-1', 'claude-2')).toBe(false)
    const claude = { ...session, agent: 'claude-20x' }
    expect(matchesSessionFilters(claude, { agent: 'claude-1' })).toBe(true)
    expect(matchesSessionFilters(claude, { agent: 'claude-2' })).toBe(false)
  })
})
