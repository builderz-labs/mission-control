import { describe, expect, it } from 'vitest'
import { detectModelFamily, resolveEdictRoleRoute } from '@/lib/edict-role-routing'

describe('edict role routing', () => {
  it('returns disabled routing for non-edict projects', () => {
    const resolved = resolveEdictRoleRoute({
      role: 'liubu',
      project: { workflow_mode: 'standard' },
      preferredModel: '9router/cc/claude-opus-4-6',
    })

    expect(resolved).toMatchObject({
      enabled: false,
      family: null,
      model: null,
    })
  })

  it('uses the liubu Claude family defaults and preferred execution model for edict tasks', () => {
    const resolved = resolveEdictRoleRoute({
      role: 'liubu',
      project: { workflow_mode: 'edict_v1' },
      preferredModel: '9router/cc/claude-opus-4-6',
    })

    expect(resolved).toMatchObject({
      enabled: true,
      family: 'claude_code',
      model: '9router/cc/claude-opus-4-6',
      sources: {
        family: 'role_default',
        model: 'preferred_model',
      },
    })
  })

  it('prefers task-level execution_model overrides over project policy and agent config', () => {
    const resolved = resolveEdictRoleRoute({
      role: 'liubu',
      task: {
        metadata: {
          execution_model: 'openai/gpt-5',
        },
      },
      project: {
        workflow_mode: 'edict_v1',
        metadata: {
          edict: {
            routing: {
              liubu: {
                family: 'claude_code',
                model: 'anthropic/claude-sonnet-4-20250514',
              },
            },
          },
        },
      },
      agentConfig: {
        model: {
          primary: 'anthropic/claude-haiku-4-5',
        },
      },
      preferredModel: '9router/cc/claude-opus-4-6',
    })

    expect(resolved).toMatchObject({
      family: 'openai',
      model: 'openai/gpt-5',
      sources: {
        family: 'task_override',
        model: 'task_override',
      },
    })
  })

  it('uses project-level aegis routing policy before agent config and global defaults', () => {
    const resolved = resolveEdictRoleRoute({
      role: 'aegis',
      project: {
        workflow_mode: 'edict_v1',
        metadata: {
          edict: {
            routing: {
              aegis: {
                family: 'openai',
                model: 'openai/gpt-5-mini',
              },
            },
          },
        },
      },
      agentConfig: {
        model: {
          primary: 'openai/gpt-4.1',
        },
      },
    })

    expect(resolved).toMatchObject({
      family: 'openai',
      model: 'openai/gpt-5-mini',
      sources: {
        family: 'project_policy',
        model: 'project_policy',
      },
    })
  })

  it('switches aegis to the opposite family when execution already used the default review family', () => {
    const resolved = resolveEdictRoleRoute({
      role: 'aegis',
      task: {
        metadata: {
          edict_routing: {
            liubu: {
              family: 'openai',
              model: 'openai/gpt-5',
              applied: true,
            },
          },
        },
      },
      project: { workflow_mode: 'edict_v1' },
    })

    expect(resolved).toMatchObject({
      family: 'claude_code',
      model: 'anthropic/claude-sonnet-4-20250514',
      sources: {
        family: 'separation_rule',
        model: 'global_default',
      },
    })
  })

  it('keeps shangshu rule-first and marks the MiniMax fallback as a placeholder model id', () => {
    const resolved = resolveEdictRoleRoute({
      role: 'shangshu',
      project: { workflow_mode: 'edict_v1' },
    })

    expect(resolved).toMatchObject({
      family: 'minimax',
      model: 'minimax-2.7',
      mode: 'rule-first',
      placeholderModel: true,
      sources: {
        family: 'role_default',
        model: 'global_default',
      },
    })
  })

  it('detects supported model families from common provider-prefixed ids', () => {
    expect(detectModelFamily('openai/gpt-5')).toBe('openai')
    expect(detectModelFamily('anthropic/claude-sonnet-4-20250514')).toBe('claude_code')
    expect(detectModelFamily('minimax/minimax-m2.1')).toBe('minimax')
  })
})
