import { describe, expect, it } from 'vitest'
import { DEPARTMENT_IDS } from './registry'
import { departmentMemoryPolicy, getDepartmentMemoryPolicy } from './memory-policy'

describe('department memory policy', () => {
  it('uses one guarded skillmem policy for every department', () => {
    expect(departmentMemoryPolicy).toHaveLength(DEPARTMENT_IDS.length)
    for (const id of DEPARTMENT_IDS) {
      const policy = getDepartmentMemoryPolicy(id)
      expect(policy.provider).toBe('skillmem')
      expect(policy.mode).toBe('READ_ONLY_ACTIVE')
      expect(policy.recall_before_nontrivial_task).toBe(true)
      expect(policy.direct_agent_write).toBe(false)
      expect(policy.reinforcement_requires_external_evidence).toBe(true)
      expect(policy.recall_terms.length).toBeGreaterThan(2)
    }
  })
})
