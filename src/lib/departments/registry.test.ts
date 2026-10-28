import { describe, expect, it } from 'vitest'
import { DEPARTMENT_IDS, costAwareExecutionPolicy, departmentRegistry, getDepartment } from './registry'

describe('department registry', () => {
  it('defines every operating department exactly once', () => {
    expect(departmentRegistry).toHaveLength(DEPARTMENT_IDS.length)
    expect(new Set(departmentRegistry.map((item) => item.id)).size).toBe(DEPARTMENT_IDS.length)
    for (const id of DEPARTMENT_IDS) {
      const department = getDepartment(id)
      expect(department.metrics.length).toBeGreaterThan(0)
      expect(department.skills.length).toBeGreaterThan(0)
      expect(department.brain_path).toMatch(/^20 Areas\/AI Company OS\/Departments\//)
    }
  })

  it('keeps optional paid AI and optimizer automation disabled by default', () => {
    expect(costAwareExecutionPolicy.paid_api_default_hard_cap_usd_per_day).toBe(0)
    expect(costAwareExecutionPolicy.optimizer_auto_run).toBe(false)
    expect(costAwareExecutionPolicy.auto_trust_learned_skills).toBe(false)
    expect(costAwareExecutionPolicy.tiers[0].executor).toBe('local-deterministic')
  })
})
