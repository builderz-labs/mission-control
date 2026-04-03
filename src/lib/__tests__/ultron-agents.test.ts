/**
 * Tests for src/lib/ultron-agents.ts
 * Validates agent hierarchy structure and task routing logic.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_ULTRON_AGENTS,
  getAgentsByTier,
  getAgentsByDepartment,
  getSubAgents,
  routeTask,
  ROUTING_TABLE,
} from '../ultron-agents'

describe('ALL_ULTRON_AGENTS', () => {
  it('contains exactly 58 agents', () => {
    expect(ALL_ULTRON_AGENTS).toHaveLength(58)
  })

  it('contains exactly 1 tier-1 commander', () => {
    const tier1 = ALL_ULTRON_AGENTS.filter(a => a.tier === 1)
    expect(tier1).toHaveLength(1)
    expect(tier1[0].id).toBe('ultron')
  })

  it('contains exactly 9 tier-2 C-suite agents', () => {
    const tier2 = ALL_ULTRON_AGENTS.filter(a => a.tier === 2)
    expect(tier2).toHaveLength(9)
  })

  it('contains exactly 48 tier-3 specialist agents', () => {
    const tier3 = ALL_ULTRON_AGENTS.filter(a => a.tier === 3)
    expect(tier3).toHaveLength(48)
  })

  it('commander has no parentId', () => {
    const commander = ALL_ULTRON_AGENTS.find(a => a.id === 'ultron')
    expect(commander?.parentId).toBeNull()
  })

  it('all tier-2 agents have ultron as parentId', () => {
    const tier2 = ALL_ULTRON_AGENTS.filter(a => a.tier === 2)
    for (const agent of tier2) {
      expect(agent.parentId).toBe('ultron')
    }
  })

  it('every agent has required fields', () => {
    for (const agent of ALL_ULTRON_AGENTS) {
      expect(agent.id).toBeTruthy()
      expect(agent.name).toBeTruthy()
      expect(agent.role).toBeTruthy()
      expect(agent.department).toBeTruthy()
      expect([1, 2, 3]).toContain(agent.tier)
      expect(agent.color).toBeTruthy()
      expect(agent.model).toBeTruthy()
      expect(agent.tokenBudget).toBeGreaterThan(0)
    }
  })

  it('has no duplicate agent ids', () => {
    const ids = ALL_ULTRON_AGENTS.map(a => a.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

describe('getAgentsByTier', () => {
  it('returns only tier-1 agents', () => {
    const agents = getAgentsByTier(1)
    expect(agents.every(a => a.tier === 1)).toBe(true)
    expect(agents).toHaveLength(1)
  })

  it('returns only tier-2 agents', () => {
    const agents = getAgentsByTier(2)
    expect(agents.every(a => a.tier === 2)).toBe(true)
    expect(agents).toHaveLength(9)
  })

  it('returns only tier-3 agents', () => {
    const agents = getAgentsByTier(3)
    expect(agents.every(a => a.tier === 3)).toBe(true)
    expect(agents).toHaveLength(48)
  })
})

describe('getAgentsByDepartment', () => {
  it('returns agents in the COMMAND department', () => {
    const agents = getAgentsByDepartment('COMMAND')
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('ultron')
  })

  it('returns empty array for unknown department', () => {
    expect(getAgentsByDepartment('NONEXISTENT')).toHaveLength(0)
  })
})

describe('getSubAgents', () => {
  it('returns all tier-2 agents as sub-agents of ultron', () => {
    const subs = getSubAgents('ultron')
    expect(subs).toHaveLength(9)
    expect(subs.every(a => a.parentId === 'ultron')).toBe(true)
  })

  it('returns empty array for an agent with no sub-agents', () => {
    // Tier-3 specialists have no children
    const tier3 = ALL_ULTRON_AGENTS.filter(a => a.tier === 3)
    const subs = getSubAgents(tier3[0].id)
    expect(subs).toHaveLength(0)
  })
})

describe('routeTask', () => {
  it('routes to cfo-ledger for financial keywords', () => {
    expect(routeTask('build me a budget spreadsheet')).toBe('cfo-ledger')
    expect(routeTask('what is our revenue this quarter')).toBe('cfo-ledger')
    expect(routeTask('create an invoice')).toBe('cfo-ledger')
  })

  it('routes to cto-omega for technical keywords', () => {
    expect(routeTask('fix this bug in the code')).toBe('cto-omega')
    expect(routeTask('deploy docker container')).toBe('cto-omega')
    expect(routeTask('build a new api endpoint')).toBe('cto-omega')
  })

  it('routes to cio-alpha for research keywords', () => {
    expect(routeTask('research the market trends')).toBe('cio-alpha')
    expect(routeTask('find me intel on competitors')).toBe('cio-alpha')
  })

  it('routes to cmo-nexus for content keywords', () => {
    expect(routeTask('write a linkedin post')).toBe('cmo-nexus')
    expect(routeTask('create a brand deck')).toBe('cmo-nexus')
  })

  it('routes to clo-relay for communication keywords', () => {
    expect(routeTask('schedule a meeting')).toBe('clo-relay')
    expect(routeTask('send an email to the team')).toBe('clo-relay')
  })

  it('routes to coo-prime for operational keywords', () => {
    expect(routeTask('optimize the workflow')).toBe('coo-prime')
    expect(routeTask('automate the reporting process')).toBe('coo-prime')
  })

  it('routes to cao-sentinel for audit keywords', () => {
    expect(routeTask('run a security scan audit')).toBe('cao-sentinel')
    expect(routeTask('check the system health status')).toBe('cao-sentinel')
  })

  it('routes to cdo-prism for design keywords', () => {
    expect(routeTask('redesign the ui for accessibility')).toBe('cdo-prism')
    expect(routeTask('create a video presentation')).toBe('cdo-prism')
  })

  it('routes to cso-venture for sales keywords', () => {
    expect(routeTask('write a sales proposal for the prospect')).toBe('cso-venture')
    expect(routeTask('close the deal with the client')).toBe('cso-venture')
  })

  it('falls back to ultron when no keywords match', () => {
    expect(routeTask('hello world')).toBe('ultron')
    expect(routeTask('')).toBe('ultron')
    expect(routeTask('something completely unrelated xyz123')).toBe('ultron')
  })

  it('is case-insensitive', () => {
    expect(routeTask('BUILD A NEW API')).toBe('cto-omega')
    expect(routeTask('REVENUE REPORT')).toBe('cfo-ledger')
  })

  it('routes first-match when text has multiple keywords', () => {
    // 'sales' and 'revenue' — 'sales' appears first in ROUTING_TABLE
    const result = routeTask('sales revenue proposal')
    expect(result).toBe('cso-venture')
  })
})

describe('ROUTING_TABLE', () => {
  it('has 9 routing entries', () => {
    expect(ROUTING_TABLE).toHaveLength(9)
  })

  it('every route has keywords and routeTo', () => {
    for (const route of ROUTING_TABLE) {
      expect(route.keywords.length).toBeGreaterThan(0)
      expect(route.routeTo).toBeTruthy()
    }
  })
})
