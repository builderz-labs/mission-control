'use client'

import { useMemo, useState, useEffect } from 'react'
import { getAvatarForAgent, buildBoxShadow } from '@/lib/pixel-avatars'
import './pixel-avatar-styles.css'

interface PixelAvatarProps {
  agentName: string
  status: 'online' | 'offline' | 'busy' | 'idle' | 'error'
  scale?: number // default 3 (48px rendered)
  showLabel?: boolean
}

export function PixelAvatar({ agentName, status, scale = 3, showLabel }: PixelAvatarProps) {
  const avatar = useMemo(() => getAvatarForAgent(agentName), [agentName])
  const [frame, setFrame] = useState(0)

  // Animate between frames when busy
  useEffect(() => {
    if (status !== 'busy') {
      setFrame(0)
      return
    }
    const interval = setInterval(() => {
      setFrame(f => (f === 0 ? 1 : 0))
    }, 400)
    return () => clearInterval(interval)
  }, [status])

  const boxShadow = useMemo(() => {
    if (!avatar) return ''
    const pixels = avatar.frames[frame] || avatar.frames[0]
    return buildBoxShadow(pixels, scale)
  }, [avatar, frame, scale])

  if (!avatar) return null

  const size = avatar.gridSize * scale
  const statusClass = `avatar-${status}`

  return (
    <div className="avatar-wrapper" style={{ width: size, height: size }}>
      <div className={statusClass} style={{ position: 'relative', width: size, height: size }}>
        <div
          style={{
            width: scale,
            height: scale,
            boxShadow,
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />
        {status === 'offline' && <span className="avatar-zzz">z</span>}
      </div>
      {showLabel && (
        <div className="avatar-label">
          <span className={`avatar-status-dot ${status}`} />
          {avatar.displayName}
        </div>
      )}
    </div>
  )
}
