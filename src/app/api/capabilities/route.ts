import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { requireRole } from '@/lib/auth'

// Sirve el catálogo de capacidades (CAPABILITIES.md, canon en helix-ecosystem).
// Parsea la tabla "## Catálogo" a JSON. Solo lectura; el canon se edita en git.
const CAPABILITIES_PATH =
  process.env.HELIX_CAPABILITIES_PATH ||
  path.join(os.homedir(), 'dev/helix-ecosystem/docs/CAPABILITIES.md')

interface Capability {
  capability: string
  surface: string
  trigger: string
  gate: string
  cost: string
  notes: string
}

function parseCatalog(markdown: string): Capability[] {
  const section = markdown.split(/^## Catálogo\s*$/m)[1]
  if (!section) return []
  const rows: Capability[] = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break // fin de la tabla
      continue
    }
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 5) continue
    if (cells[0] === 'capability' || /^-+$/.test(cells[0])) continue
    rows.push({
      capability: cells[0],
      surface: cells[1],
      trigger: cells[2],
      gate: cells[3],
      cost: cells[4],
      notes: cells[5] || '',
    })
  }
  return rows
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const stat = fs.statSync(CAPABILITIES_PATH)
    const capabilities = parseCatalog(fs.readFileSync(CAPABILITIES_PATH, 'utf8'))
    return NextResponse.json({
      updatedAt: Math.floor(stat.mtimeMs / 1000),
      total: capabilities.length,
      capabilities,
    })
  } catch {
    return NextResponse.json(
      { error: `Catálogo no disponible — se esperaba en ${CAPABILITIES_PATH}` },
      { status: 404 }
    )
  }
}
