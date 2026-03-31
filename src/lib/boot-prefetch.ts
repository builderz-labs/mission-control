export interface BootPrefetchPlan {
  agents: boolean
  sessions: boolean
  projects: boolean
  memory: boolean
  skills: boolean
}

const ALL_DISABLED: BootPrefetchPlan = {
  agents: false,
  sessions: false,
  projects: false,
  memory: false,
  skills: false,
}

const ALL_ENABLED: BootPrefetchPlan = {
  agents: true,
  sessions: true,
  projects: true,
  memory: true,
  skills: true,
}

export function getBootPrefetchPlan(panelId: string): BootPrefetchPlan {
  const panel = String(panelId || 'overview').toLowerCase()

  if (panel === 'overview' || panel === 'dashboard') {
    return ALL_ENABLED
  }

  if (panel === 'office' || panel === 'chat') {
    return {
      ...ALL_DISABLED,
      agents: true,
      sessions: true,
    }
  }

  if (panel === 'memory' || panel === 'nodes') {
    return {
      ...ALL_DISABLED,
      memory: true,
    }
  }

  if (panel === 'skills') {
    return {
      ...ALL_DISABLED,
      skills: true,
    }
  }

  return ALL_DISABLED
}
