'use client'

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Delegation edge: solid line with animated dash pattern (flow direction).
 */
export function DelegationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  ...rest
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        strokeWidth: 2,
        stroke: 'var(--primary)',
        strokeDasharray: '6 3',
        animation: 'dash-flow 1s linear infinite',
        ...style,
      }}
      {...rest}
    />
  )
}

/**
 * Communication edge: dotted line for bidirectional messaging.
 */
export function CommunicationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  style,
  ...rest
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <BaseEdge
      path={edgePath}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={{
        strokeWidth: 1.5,
        stroke: 'var(--muted-foreground)',
        strokeDasharray: '2 4',
        ...style,
      }}
      {...rest}
    />
  )
}

/**
 * Supervision edge: thick solid line for oversight relationships.
 */
export function SupervisionEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  ...rest
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        strokeWidth: 3,
        stroke: 'var(--primary)',
        ...style,
      }}
      {...rest}
    />
  )
}
