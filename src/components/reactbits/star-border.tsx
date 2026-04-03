'use client'

import React from 'react'

interface StarBorderProps {
  readonly children: React.ReactNode
  readonly className?: string
  readonly color?: string
  readonly speed?: string
}

/**
 * A glowing animated star/comet border that orbits around the element.
 * Inspired by ReactBits StarBorder — pure CSS keyframe animation.
 */
export default function StarBorder({
  children,
  className = '',
  color = '#22D3EE',
  speed = '6s',
}: StarBorderProps) {
  return (
    <div
      className={`relative inline-block overflow-hidden rounded-xl ${className}`}
      style={{
        '--star-color': color,
        '--star-speed': speed,
      } as React.CSSProperties}
    >
      {/* Animated border gradient — top edge */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 overflow-hidden rounded-xl"
        style={{ padding: '1px' }}
      >
        <div
          className="absolute h-[200%] w-[200%] animate-spin rounded-full"
          style={{
            background: `conic-gradient(from 0deg, transparent 0%, transparent 70%, var(--star-color) 80%, transparent 90%, transparent 100%)`,
            top: '-50%',
            left: '-50%',
            animationDuration: 'var(--star-speed)',
            animationTimingFunction: 'linear',
          }}
        />
      </div>
      {/* Inner content with inset background */}
      <div className="relative z-10 rounded-[11px] bg-card">{children}</div>
    </div>
  )
}
