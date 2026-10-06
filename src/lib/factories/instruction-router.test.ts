import { describe, expect, it } from 'vitest'
import { routeInstruction } from './instruction-router'

describe('instruction router', () => {
  it('plans Shufuro content resolution before video render and QA', () => {
    const plan = routeInstruction('Create a Shufuro marketing video: resolve the content, render it, and perform QA before publishing.')
    expect(plan.steps.map(({ area }) => area)).toEqual(['marketing', 'creative-video'])
    expect(plan.steps[0].objective).toContain('marketing and content direction')
    expect(plan.steps[1].objective).toContain('render and perform quality checks')
    expect(plan.steps.at(-1)).toMatchObject({ status: 'requires-human-approval', requires_human_approval: true })
    expect(plan.executor_availability['claude-code']).toBe(false)
  })

  it('routes bounded implementation to Codex medium', () => {
    const plan = routeInstruction('Implement a small validation helper in the codebase.')
    expect(plan.steps.map(({ area, executor }) => [area, executor])).toEqual([['dev', 'codex-medium']])
  })

  it('routes read-only research to deterministic execution', () => {
    const plan = routeInstruction('Research current competitor messaging and summarize the sources.')
    expect(plan.steps.map(({ area, executor }) => [area, executor])).toEqual([['search', 'deterministic']])
    expect(plan.requires_human_approval).toBe(false)
  })

  it('adds a human approval gate for publish and deploy actions', () => {
    for (const goal of ['Publish the approved campaign', 'Deploy the completed application']) {
      const plan = routeInstruction(goal)
      expect(plan.requires_human_approval).toBe(true)
      expect(plan.steps.at(-1)).toMatchObject({
        id: 'human-approval', status: 'requires-human-approval', requires_human_approval: true,
      })
    }
  })
})
