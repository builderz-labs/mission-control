'use client'

import { useState, useEffect, useMemo } from 'react'
import { PixelAvatar } from '@/components/office/PixelAvatar'
import { AvatarExporter } from '@/components/office/AvatarExporter'
import '@/components/office/pixel-avatar-styles.css'

interface Agent {
  name: string
  status: 'online' | 'offline' | 'busy' | 'idle' | 'error'
}

// Room layout configuration
interface Room {
  id: string
  label: string
  agentId: string | null // null = shared/no assigned agent
  col: string // CSS grid column
  row: string // CSS grid row
  bg: string
}

const ROOMS: Room[] = [
  { id: 'dev-bay', label: 'Dev Bay', agentId: 'jarvis-dev', col: '1 / 2', row: '1 / 2', bg: '#1e2a3a' },
  { id: 'meeting', label: 'Meeting Room', agentId: null, col: '2 / 3', row: '1 / 2', bg: '#1a2438' },
  { id: 'life-studio', label: 'Life Studio', agentId: 'jarvis-life', col: '3 / 4', row: '1 / 2', bg: '#2a1a2e' },
  { id: 'finance', label: 'Finance', agentId: 'friday', col: '1 / 2', row: '2 / 3', bg: '#1a2e24' },
  { id: 'str-suite', label: 'STR Suite', agentId: 'bnb-hero', col: '2 / 3', row: '2 / 3', bg: '#2e2a1a' },
  { id: 'fintech-lab', label: 'Fintech Lab', agentId: 'sukuqi', col: '3 / 4', row: '2 / 3', bg: '#221a2e' },
  { id: 'scout-post', label: 'Scout Post', agentId: 'hostai-scout', col: '1 / 2', row: '3 / 4', bg: '#1a282e' },
  { id: 'canteen', label: 'Canteen / Aegis Tower', agentId: 'aegis', col: '2 / 4', row: '3 / 4', bg: '#1e1a2a' },
]

// Map agent IDs to their "home" room
const AGENT_HOME_ROOM: Record<string, string> = {
  'jarvis-dev': 'dev-bay',
  'jarvis-life': 'life-studio',
  'friday': 'finance',
  'bnb-hero': 'str-suite',
  'sukuqi': 'fintech-lab',
  'hostai-scout': 'scout-post',
  'aegis': 'canteen',
}

// All known agent IDs for fallback
const ALL_AGENT_IDS = ['jarvis-dev', 'jarvis-life', 'friday', 'bnb-hero', 'sukuqi', 'hostai-scout', 'aegis']

export function VirtualOfficePanel() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [showExporter, setShowExporter] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Fetch agents
  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => {
        const data = d.data || d || []
        if (Array.isArray(data) && data.length > 0) {
          setAgents(data.map((a: Agent) => ({
            name: a.name,
            status: a.status || 'offline',
          })))
        } else {
          // Fallback: show all agents as idle
          setAgents(ALL_AGENT_IDS.map(id => ({ name: id, status: 'idle' as const })))
        }
      })
      .catch(() => {
        setAgents(ALL_AGENT_IDS.map(id => ({ name: id, status: 'idle' as const })))
      })
  }, [])

  // SSE live updates
  useEffect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/events')
      es.addEventListener('agent.status_changed', (e) => {
        const data = JSON.parse(e.data)
        setAgents(prev => prev.map(a => a.name === data.name ? { ...a, status: data.status } : a))
      })
      es.onerror = () => {
        es?.close()
      }
    } catch {
      // SSE not available
    }
    return () => { es?.close() }
  }, [])

  // Clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Determine where each agent should be rendered
  const agentPlacements = useMemo(() => {
    const placements: Record<string, string> = {} // agentId → roomId
    for (const agent of agents) {
      const home = AGENT_HOME_ROOM[agent.name]
      if (!home) continue
      if (agent.status === 'idle' || agent.status === 'online') {
        placements[agent.name] = 'canteen' // idle agents go to canteen
      } else {
        placements[agent.name] = home // busy/offline/error stay at desk
      }
    }
    return placements
  }, [agents])

  // Build map of roomId → agents in that room
  const roomAgents = useMemo(() => {
    const map: Record<string, Agent[]> = {}
    for (const room of ROOMS) map[room.id] = []
    for (const agent of agents) {
      const roomId = agentPlacements[agent.name]
      if (roomId && map[roomId]) {
        map[roomId].push(agent)
      }
    }
    return map
  }, [agents, agentPlacements])

  const timeStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  if (showExporter) {
    return (
      <div className="p-6">
        <AvatarExporter onClose={() => setShowExporter(false)} />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, background: '#0f0f1a', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 20, fontWeight: 700 }}>Virtual Office</h2>
          <span style={{ color: '#888', fontSize: 12 }}>{timeStr}</span>
        </div>
        <button
          onClick={() => setShowExporter(true)}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#ffffff08',
            color: '#aaa',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Export Avatars
        </button>
      </div>

      {/* Office grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, minmax(160px, 1fr))',
          gap: 2,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid #333',
          maxWidth: 900,
        }}
      >
        {ROOMS.map(room => (
          <div
            key={room.id}
            style={{
              gridColumn: room.col,
              gridRow: room.row,
              background: room.bg,
              padding: 16,
              position: 'relative',
              minHeight: 160,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Room label */}
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#ffffff50',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 12,
            }}>
              {room.label}
            </span>

            {/* Desk furniture */}
            <div style={{
              position: 'absolute',
              bottom: 40,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}>
              {/* Monitor */}
              <div style={{
                width: 18,
                height: 12,
                background: '#4a90d9',
                borderRadius: 2,
                boxShadow: '0 0 6px #4a90d930',
              }} />
              {/* Monitor stand */}
              <div style={{ width: 4, height: 4, background: '#555' }} />
              {/* Desk surface */}
              <div style={{
                width: 40,
                height: 6,
                background: '#4a3828',
                borderRadius: 1,
              }} />
            </div>

            {/* Agents in this room */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: 12,
              paddingBottom: 4,
              flexWrap: 'wrap',
              transition: 'all 1s ease',
            }}>
              {(roomAgents[room.id] || []).map(agent => (
                <div
                  key={agent.name}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    transition: 'all 1s ease',
                  }}
                >
                  <PixelAvatar
                    agentName={agent.name}
                    status={agent.status}
                    scale={3}
                    showLabel
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 16,
        flexWrap: 'wrap',
      }}>
        {[
          { status: 'busy', label: 'Working', color: '#f59e0b' },
          { status: 'online', label: 'Online', color: '#22c55e' },
          { status: 'idle', label: 'Idle', color: '#a3e635' },
          { status: 'offline', label: 'Offline', color: '#6b7280' },
          { status: 'error', label: 'Error', color: '#ef4444' },
        ].map(s => (
          <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: s.color,
            }} />
            <span style={{ color: '#888', fontSize: 10 }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
