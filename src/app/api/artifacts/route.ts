import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { requireRole } from '@/lib/auth'

// Lista los artefactos de la galería Helix (~/artifacts/*.html) para embeberlos
// en MC en vez de solo enlazar afuera. El render sigue sirviéndose desde el
// artifacts-server (:8446, con live-reload SSE); MC solo aporta el índice.
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(os.homedir(), 'artifacts')
const ARTIFACTS_URL = (process.env.MC_ARTIFACTS_URL || 'https://helix.tail304cfc.ts.net:8446').replace(/\/$/, '')

function titleOf(file: string): string {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000)
    const m = head.match(/<title>([\s\S]*?)<\/title>/i)
    if (m) return m[1].trim().slice(0, 120)
  } catch {
    /* sin título legible → usa el nombre */
  }
  return path.basename(file, '.html')
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let files: string[]
  try {
    files = fs.readdirSync(ARTIFACTS_DIR).filter(f => f.endsWith('.html'))
  } catch {
    return NextResponse.json({ error: `Galería no disponible en ${ARTIFACTS_DIR}`, artifacts: [] }, { status: 200 })
  }

  const artifacts = files
    .map(f => {
      const full = path.join(ARTIFACTS_DIR, f)
      const stat = fs.statSync(full)
      return {
        name: f,
        title: titleOf(full),
        updatedAt: Math.floor(stat.mtimeMs / 1000),
        url: `${ARTIFACTS_URL}/${encodeURIComponent(f)}`,
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return NextResponse.json({ artifacts, galleryUrl: ARTIFACTS_URL, total: artifacts.length })
}
