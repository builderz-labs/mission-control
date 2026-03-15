import type { NodeTypes, EdgeTypes } from '@xyflow/react'
import { AgentNodeComponent } from './agent-node'
import { TeamGroupNode } from './team-group-node'
import { DelegationEdge, CommunicationEdge, SupervisionEdge } from './relationship-edge'
import { AnimatedMessageEdge } from './animated-edge'

/**
 * Custom node types for the spatial agent topology canvas.
 * Pass to <ReactFlow nodeTypes={agentNodeTypes} />.
 */
export const agentNodeTypes: NodeTypes = {
  agent: AgentNodeComponent,
  team: TeamGroupNode,
}

/**
 * Custom edge types for agent relationship visualization.
 * Pass to <ReactFlow edgeTypes={agentEdgeTypes} />.
 *
 * - delegation: Solid animated-dash line (task delegation flow)
 * - communication: Dotted line (bidirectional messaging)
 * - supervision: Thick solid line (oversight relationship)
 * - animated: Particle-along-path (live message flow)
 */
export const agentEdgeTypes: EdgeTypes = {
  delegation: DelegationEdge,
  communication: CommunicationEdge,
  supervision: SupervisionEdge,
  animated: AnimatedMessageEdge,
}
