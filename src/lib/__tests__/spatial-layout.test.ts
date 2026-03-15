import { describe, it, expect } from 'vitest'
import { applyDagreLayout } from '@/lib/spatial-layout'
import type { AgentNode, AgentEdge } from '@/store/canvas-store'

function makeNode(id: string, agentId: number): AgentNode {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { label: `Agent ${agentId}`, status: 'online', role: 'worker', agentId },
  }
}

describe('applyDagreLayout', () => {
  it('returns empty arrays for empty input', () => {
    const result = applyDagreLayout([], [])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('positions a single node', () => {
    const nodes: AgentNode[] = [makeNode('agent-1', 1)]
    const result = applyDagreLayout(nodes, [])
    expect(result.nodes).toHaveLength(1)
    expect(typeof result.nodes[0].position.x).toBe('number')
    expect(typeof result.nodes[0].position.y).toBe('number')
  })

  it('positions multiple nodes without overlap', () => {
    const nodes: AgentNode[] = [
      makeNode('agent-1', 1),
      makeNode('agent-2', 2),
      makeNode('agent-3', 3),
    ]
    const edges: AgentEdge[] = [
      { id: 'e-1-2', source: 'agent-1', target: 'agent-2' },
      { id: 'e-1-3', source: 'agent-1', target: 'agent-3' },
    ]

    const result = applyDagreLayout(nodes, edges)
    expect(result.nodes).toHaveLength(3)

    // Verify no two nodes share the same position
    const positions = result.nodes.map((n) => `${n.position.x},${n.position.y}`)
    const unique = new Set(positions)
    expect(unique.size).toBe(3)
  })

  it('positions 50 nodes in under 100ms', () => {
    const nodes: AgentNode[] = Array.from({ length: 50 }, (_, i) => makeNode(`agent-${i}`, i))
    const edges: AgentEdge[] = Array.from({ length: 80 }, (_, i) => ({
      id: `e-${i}`,
      source: `agent-${i % 50}`,
      target: `agent-${(i + 1) % 50}`,
    }))

    const start = performance.now()
    const result = applyDagreLayout(nodes, edges)
    const elapsed = performance.now() - start

    expect(result.nodes).toHaveLength(50)
    expect(elapsed).toBeLessThan(100)
  })

  it('supports LR direction', () => {
    const nodes: AgentNode[] = [makeNode('agent-1', 1), makeNode('agent-2', 2)]
    const edges: AgentEdge[] = [{ id: 'e-1-2', source: 'agent-1', target: 'agent-2' }]

    const tb = applyDagreLayout(nodes, edges, { direction: 'TB' })
    const lr = applyDagreLayout(nodes, edges, { direction: 'LR' })

    // In TB, agent-2 should be below agent-1 (higher y)
    // In LR, agent-2 should be right of agent-1 (higher x)
    expect(tb.nodes[1].position.y).toBeGreaterThan(tb.nodes[0].position.y)
    expect(lr.nodes[1].position.x).toBeGreaterThan(lr.nodes[0].position.x)
  })

  it('preserves node data through layout', () => {
    const nodes: AgentNode[] = [makeNode('agent-1', 1)]
    nodes[0].data.status = 'busy'
    nodes[0].data.role = 'orchestrator'

    const result = applyDagreLayout(nodes, [])
    expect(result.nodes[0].data.status).toBe('busy')
    expect(result.nodes[0].data.role).toBe('orchestrator')
    expect(result.nodes[0].data.agentId).toBe(1)
  })
})
