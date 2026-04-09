'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import type { Agent } from '@/store'
import type { ThemePalette } from './office-types'
import {
  statusDot,
  hashColor,
  getStatusEmote,
  getWorkerHeroFrame,
  HERO_SHEET_COLS,
  HERO_SHEET_ROWS,
} from './office-utils'

interface WorkerSpriteProps {
  agent: Agent
  x: number
  y: number
  zoneLabel: string
  seatLabel: string
  isMoving: boolean
  direction: { dx: number; dy: number }
  spriteFrame: number
  transitioningAgentIds: Set<number>
  agentActionOverrides: Map<number, string>
  themePalette: ThemePalette
  setSelectedAgent: (agent: Agent | null) => void
}

export function WorkerSprite({
  agent,
  x,
  y,
  zoneLabel,
  seatLabel,
  isMoving,
  direction,
  spriteFrame,
  transitioningAgentIds,
  agentActionOverrides,
  themePalette,
  setSelectedAgent,
}: WorkerSpriteProps): React.ReactElement {
  const isTransitioning = transitioningAgentIds.has(agent.id)
  const frame = getWorkerHeroFrame(agent.status, isMoving, spriteFrame)
  const xPct = (frame.col / (HERO_SHEET_COLS - 1)) * 100
  const yPct = (frame.row / (HERO_SHEET_ROWS - 1)) * 100
  const flipX = isMoving && Math.abs(direction.dx) > Math.abs(direction.dy) && direction.dx < 0

  return (
    <div key={agent.id}>
      {/* Chair */}
      <div
        className="absolute -translate-x-1/2 pointer-events-none"
        style={{ left: `${x}%`, top: `calc(${y}% - 14px)` }}
      >
        <Image
          src="/office-sprites/kenney/chairDesk.png"
          alt=""
          aria-hidden="true"
          width={22}
          height={21}
          unoptimized
          className="w-6 h-6 object-contain opacity-90"
          style={{ imageRendering: 'pixelated' }}
          draggable={false}
        />
      </div>

      {/* Desk + monitor */}
      <div
        className="absolute -translate-x-1/2 pointer-events-none"
        style={{ left: `${x}%`, top: `calc(${y}% - 56px)` }}
      >
        <div className="relative w-16 h-9">
          <Image
            src="/office-sprites/kenney/desk.png"
            alt=""
            aria-hidden="true"
            width={64}
            height={32}
            unoptimized
            className="w-16 h-9 object-contain opacity-95"
            style={{ imageRendering: 'pixelated', filter: themePalette.spriteFilter }}
            draggable={false}
          />
          <Image
            src="/office-sprites/kenney/computerScreen.png"
            alt=""
            aria-hidden="true"
            width={20}
            height={6}
            unoptimized
            className="absolute left-1/2 -translate-x-1/2 top-[6px] w-7 h-2 object-contain opacity-95"
            style={{ imageRendering: 'pixelated', filter: themePalette.spriteFilter }}
            draggable={false}
          />
        </div>
      </div>

      {/* Clickable agent sprite */}
      <Button
        variant="ghost"
        onClick={() => setSelectedAgent(agent)}
        className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-500 hover:scale-110 h-auto p-0 rounded-none hover:bg-transparent"
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 border border-white/10 text-white text-[11px] px-2 py-0.5 shadow-[0_0_12px_rgba(0,0,0,0.4)]">
          <span className={`inline-block w-2 h-2 rounded-full ${statusDot[agent.status]} mr-1`} />
          {agent.name}
        </div>
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-sm">
          <span className={`${agent.status === 'busy' ? 'animate-bounce' : 'animate-pulse'}`}>{getStatusEmote(agent.status)}</span>
        </div>
        <div className="relative w-8 h-12 mx-auto">
          <div
            className={`absolute inset-0 ${isTransitioning || isMoving ? 'animate-pulse' : ''}`}
            style={{
              backgroundImage: `url('/office-sprites/cc0-hero/player_full_animation.png')`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${HERO_SHEET_COLS * 100}% ${HERO_SHEET_ROWS * 100}%`,
              backgroundPosition: `${xPct}% ${yPct}%`,
              imageRendering: 'pixelated',
              filter: themePalette.spriteFilter,
              transform: flipX ? 'scaleX(-1)' : undefined,
              transformOrigin: 'center',
            }}
          />
          <div className={`absolute left-[8px] top-[14px] w-4 h-3 ${hashColor(agent.name)} border border-black/60`} />
        </div>
        {!isMoving && <div className="text-[9px] text-slate-300 font-mono mt-0.5">#{seatLabel}</div>}
      </Button>

      {/* Action override label */}
      {agentActionOverrides.has(agent.id) && (
        <div
          className="absolute -translate-x-1/2 text-[9px] px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-cyan-200"
          style={{ left: `${x}%`, top: `calc(${y}% - 24px)` }}
        >
          {agentActionOverrides.get(agent.id)}
        </div>
      )}

      {/* Moving badge */}
      {(isTransitioning || isMoving) && (
        <div
          className="absolute -translate-x-1/2 text-[9px] text-slate-200/85 font-medium px-1.5 py-0.5 rounded bg-black/45 border border-white/10"
          style={{ left: `${x}%`, top: `calc(${y}% + 22px)` }}
        >
          moving
        </div>
      )}

      {/* Zone label */}
      <div
        className="absolute text-[9px] text-slate-500/70 font-mono pointer-events-none"
        style={{ left: `${x}%`, top: `calc(${y}% + 38px)` }}
      >
        {zoneLabel}
      </div>
    </div>
  )
}
