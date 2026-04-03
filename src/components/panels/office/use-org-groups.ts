// Derives the org-chart group maps from the visible agent list.
// Separated so category/role/status bucketing logic doesn't bloat the shell.

import { useMemo } from 'react'
import type { Agent } from '@/store'
import type { OrgSegmentMode } from './office-types'
import { statusLabel } from './office-utils'

function getCategory(agent: Agent): string {
  const name = (agent.name || '').toLowerCase()
  if (name.startsWith('habi-')) return 'Habi Lanes'
  if (name.startsWith('ops-')) return 'Ops Automation'
  if (name.includes('canary')) return 'Canary'
  if (name.startsWith('main')) return 'Core'
  if (name.startsWith('remote-')) return 'Remote'
  return 'Other'
}

function sortedMap(
  groups: Map<string, Agent[]>,
  order: string[],
): Map<string, Agent[]> {
  return new Map(
    [...groups.entries()].sort(([a], [b]) => {
      const av = order.indexOf(a)
      const bv = order.indexOf(b)
      const ai = av === -1 ? Number.MAX_SAFE_INTEGER : av
      const bi = bv === -1 ? Number.MAX_SAFE_INTEGER : bv
      return ai !== bi ? ai - bi : a.localeCompare(b)
    }),
  )
}

interface UseOrgGroupsResult {
  orgGroups: Map<string, Agent[]>
}

export function useOrgGroups(
  visibleDisplayAgents: Agent[],
  orgSegmentMode: OrgSegmentMode,
): UseOrgGroupsResult {
  const roleGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    for (const a of visibleDisplayAgents) {
      const role = a.role || 'Unassigned'
      if (!groups.has(role)) groups.set(role, [])
      groups.get(role)!.push(a)
    }
    return groups
  }, [visibleDisplayAgents])

  const categoryGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    for (const a of visibleDisplayAgents) {
      const cat = getCategory(a)
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(a)
    }
    return sortedMap(groups, ['Habi Lanes', 'Ops Automation', 'Core', 'Canary', 'Remote', 'Other'])
  }, [visibleDisplayAgents])

  const statusGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    for (const a of visibleDisplayAgents) {
      const key = statusLabel[a.status] || a.status
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(a)
    }
    return sortedMap(groups, ['Working', 'Available', 'Error', 'Away'])
  }, [visibleDisplayAgents])

  const orgGroups = useMemo(() => {
    if (orgSegmentMode === 'role') return roleGroups
    if (orgSegmentMode === 'status') return statusGroups
    return categoryGroups
  }, [categoryGroups, orgSegmentMode, roleGroups, statusGroups])

  return { orgGroups }
}
