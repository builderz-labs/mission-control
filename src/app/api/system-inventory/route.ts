import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'

// Sirve el inventario del ecosistema escrito por helix-ops/scripts/system-collector.sh
// (LaunchAgent com.helix.cron.system-collector, cada 15 min). Solo lectura.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const file = path.join(config.dataDir, 'system-inventory.json')
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'Inventario no disponible — corre system-collector.sh' },
      { status: 404 }
    )
  }
}
