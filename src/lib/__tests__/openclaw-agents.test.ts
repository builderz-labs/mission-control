import { describe, expect, it } from 'vitest'
import {
  findOpenClawAgent,
  listOpenClawAgents,
  removeOpenClawAgent,
  upsertOpenClawAgent,
} from '@/lib/openclaw-agents'

describe('listOpenClawAgents', () => {
  it('reads agents.entries and fills workspace from state dir', () => {
    const listed = listOpenClawAgents(
      { agents: { ownership: 'explicit', entries: { grok: { name: 'grok', identity: { theme: 'researcher' } } } } },
      '/tmp/oc',
    )
    expect(listed).toEqual([
      {
        name: 'grok',
        identity: { theme: 'researcher' },
        id: 'grok',
        workspace: '/tmp/oc/workspace-grok',
      },
    ])
  })

  it('falls back to agents.list', () => {
    const listed = listOpenClawAgents({ agents: { list: [{ id: 'codex', name: 'codex' }] } })
    expect(listed.map((agent) => agent.id)).toEqual(['codex'])
  })

  it('returns [] when neither list nor entries exist', () => {
    expect(listOpenClawAgents({ agents: {} })).toEqual([])
  })
})

describe('upsertOpenClawAgent', () => {
  it('updates entries without creating agents.list', () => {
    const parsed: Record<string, unknown> = {
      agents: { entries: { grok: { name: 'grok' } } },
    }
    upsertOpenClawAgent(parsed, { id: 'grok', name: 'grok', identity: { theme: 'researcher' } })
    const agents = parsed.agents as { entries: Record<string, { name?: string; identity?: { theme?: string } }>; list?: unknown }
    expect(agents.list).toBeUndefined()
    expect(agents.entries.grok).toEqual({ name: 'grok', identity: { theme: 'researcher' } })
  })

  it('keeps legacy list files on the list schema', () => {
    const parsed: Record<string, unknown> = { agents: { list: [{ id: 'neo', name: 'neo' }] } }
    upsertOpenClawAgent(parsed, { id: 'neo', model: { primary: 'anthropic/claude' } })
    const agents = parsed.agents as { list: Array<{ id: string; model?: { primary?: string } }> }
    expect(agents.list[0].model?.primary).toBe('anthropic/claude')
  })
})

describe('removeOpenClawAgent', () => {
  it('deletes an entries key by id', () => {
    const parsed: Record<string, unknown> = {
      agents: { entries: { grok: { name: 'grok' }, kimi: { name: 'kimi' } } },
    }
    expect(removeOpenClawAgent(parsed, { id: 'grok' })).toBe(true)
    expect(findOpenClawAgent(parsed, 'grok')).toBeNull()
    expect(findOpenClawAgent(parsed, 'kimi')?.id).toBe('kimi')
  })
})
