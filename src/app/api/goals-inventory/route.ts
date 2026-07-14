import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'

// Sirve las metas por horizontes escritas por helix-ops/scripts/goals-collector.sh
// (LaunchAgent com.helix.cron.goals-collector, cada 30 min). Solo lectura.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const file = path.join(config.dataDir, 'goals-inventory.json')
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Metas no disponibles — corre goals-collector.sh' },
      { status: 404 }
    )
  }
}
