'use client'

import { getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Animated message edge: shows a particle (small circle) traveling along the
 * path using SVG <animateMotion>. Useful for visualizing live message flow
 * between agents when spatial.message.flow events arrive.
 */
export function AnimatedMessageEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  id,
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
    <g>
      {/* Base path (semi-transparent) */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        strokeWidth={1.5}
        stroke="var(--primary)"
        strokeOpacity={0.3}
        markerEnd={markerEnd}
        style={style}
      />

      {/* Particle circle that travels along the path */}
      <circle r={4} fill="var(--primary)" opacity={0.9}>
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>

      {/* Glow trail circle (larger, more transparent) */}
      <circle r={7} fill="var(--primary)" opacity={0.2}>
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
    </g>
  )
}
