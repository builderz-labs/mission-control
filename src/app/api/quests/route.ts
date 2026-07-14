import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'

// Quest board + progresión New Game (HLX-206). Fuentes que escribe el
// quest-engine / newgame en el workspace de OpenClaw. Solo lectura.
const OUTPUT_DIR =
  process.env.HELIX_NEWGAME_DIR || path.join(config.openclawStateDir, 'workspace', 'output')

interface Quest {
  name: string
  why?: string
  ref?: string
  source?: string
  urgency?: 'alta' | 'media' | 'baja' | string
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const questsFile = readJson<{ generatedAt?: string; quests?: Quest[]; closedYesterday?: unknown[] }>(
    path.join(OUTPUT_DIR, 'quests', 'latest.json')
  )
  const state = readJson<{
    player?: { xp: number; level: number; nextLevelAt: number }
    stats?: { questsClosedTotal?: number }
    achievements?: { id: string; name: string; rule?: string; unlockedAt?: string }[]
    hiddenLocked?: number
    updatedAt?: string
  }>(path.join(OUTPUT_DIR, 'newgame', 'state.json'))

  if (!questsFile && !state) {
    return NextResponse.json(
      { error: `Quest engine sin salida en ${OUTPUT_DIR}`, quests: [] },
      { status: 200 }
    )
  }

  return NextResponse.json({
    generatedAt: questsFile?.generatedAt ?? null,
    quests: questsFile?.quests ?? [],
    closedYesterday: Array.isArray(questsFile?.closedYesterday) ? questsFile!.closedYesterday.length : 0,
    player: state?.player ?? null,
    questsClosedTotal: state?.stats?.questsClosedTotal ?? null,
    achievements: state?.achievements ?? [],
    hiddenLocked: state?.hiddenLocked ?? 0,
    stateUpdatedAt: state?.updatedAt ?? null,
  })
}
