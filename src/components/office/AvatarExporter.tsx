'use client'

import { useState } from 'react'
import { AGENT_AVATARS, renderAvatarToCanvas } from '@/lib/pixel-avatars'
import { PixelAvatar } from './PixelAvatar'

const SIZES = [48, 96, 128] as const

export function AvatarExporter({ onClose }: { onClose?: () => void }) {
  const [selectedSize, setSelectedSize] = useState<number>(96)
  const agents = Object.values(AGENT_AVATARS)

  function handleDownload(agentId: string) {
    const def = AGENT_AVATARS[agentId]
    if (!def) return
    const canvas = renderAvatarToCanvas(def, selectedSize, 0)
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `${agentId}-${selectedSize}px.png`
    a.click()
  }

  function handleDownloadAll() {
    for (const agent of agents) {
      handleDownload(agent.id)
    }
  }

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #333',
      borderRadius: 12,
      padding: 24,
      maxWidth: 600,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>Export Avatars</h3>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}
          >
            x
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {SIZES.map(s => (
          <button
            key={s}
            onClick={() => setSelectedSize(s)}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: selectedSize === s ? '2px solid #3b82f6' : '1px solid #555',
              background: selectedSize === s ? '#3b82f620' : 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {s}px
          </button>
        ))}
        <button
          onClick={handleDownloadAll}
          style={{
            marginLeft: 'auto',
            padding: '4px 12px',
            borderRadius: 6,
            border: '1px solid #555',
            background: '#3b82f620',
            color: '#3b82f6',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Download All
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
        {agents.map(agent => (
          <div
            key={agent.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: 12,
              background: '#ffffff08',
              borderRadius: 8,
            }}
          >
            <PixelAvatar agentName={agent.id} status="online" scale={4} />
            <span style={{ color: '#ccc', fontSize: 11, fontWeight: 600 }}>{agent.displayName}</span>
            <button
              onClick={() => handleDownload(agent.id)}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: '1px solid #555',
                background: 'transparent',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Download PNG
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
