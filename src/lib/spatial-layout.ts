import dagre from '@dagrejs/dagre'
import type { AgentNode, AgentEdge } from '@/store/canvas-store'

/**
 * Apply dagre hierarchical layout to agent nodes.
 * Nodes without saved positions get auto-placed; nodes with saved positions are preserved.
 */
export function applyDagreLayout(
  nodes: AgentNode[],
  edges: AgentEdge[],
  options?: { direction?: 'TB' | 'LR'; nodeWidth?: number; nodeHeight?: number }
): { nodes: AgentNode[]; edges: AgentEdge[] } {
  if (nodes.length === 0) return { nodes, edges }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: options?.direction ?? 'TB',
    nodesep: 80,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  })

  const nodeWidth = options?.nodeWidth ?? 180
  const nodeHeight = options?.nodeHeight ?? 60

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const layoutNodes = nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    return {
      ...node,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
    }
  })

  return { nodes: layoutNodes, edges }
}
