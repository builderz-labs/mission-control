import { describe, expect, it } from 'vitest'
import { getBootPrefetchPlan } from '@/lib/boot-prefetch'

describe('boot-prefetch', () => {
  it('enables all preload lanes for overview', () => {
    expect(getBootPrefetchPlan('overview')).toEqual({
      agents: true,
      sessions: true,
      projects: true,
      memory: true,
      skills: true,
    })
  })

  it('only preloads agents and sessions for office and chat', () => {
    expect(getBootPrefetchPlan('office')).toEqual({
      agents: true,
      sessions: true,
      projects: false,
      memory: false,
      skills: false,
    })
    expect(getBootPrefetchPlan('chat')).toEqual({
      agents: true,
      sessions: true,
      projects: false,
      memory: false,
      skills: false,
    })
  })

  it('only preloads memory for memory-centric panels', () => {
    expect(getBootPrefetchPlan('memory')).toEqual({
      agents: false,
      sessions: false,
      projects: false,
      memory: true,
      skills: false,
    })
    expect(getBootPrefetchPlan('nodes')).toEqual({
      agents: false,
      sessions: false,
      projects: false,
      memory: true,
      skills: false,
    })
  })

  it('only preloads skills for skills panel', () => {
    expect(getBootPrefetchPlan('skills')).toEqual({
      agents: false,
      sessions: false,
      projects: false,
      memory: false,
      skills: true,
    })
  })

  it('skips non-essential boot prefetch for operational panels', () => {
    expect(getBootPrefetchPlan('tasks')).toEqual({
      agents: false,
      sessions: false,
      projects: false,
      memory: false,
      skills: false,
    })
    expect(getBootPrefetchPlan('cron')).toEqual({
      agents: false,
      sessions: false,
      projects: false,
      memory: false,
      skills: false,
    })
    expect(getBootPrefetchPlan('security')).toEqual({
      agents: false,
      sessions: false,
      projects: false,
      memory: false,
      skills: false,
    })
  })
})
