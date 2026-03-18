import { NextResponse } from 'next/server'
import { spawnSync } from 'node:child_process'

const headers = { 'Cache-Control': 'public, max-age=3600' }

/**
 * GET /api/hermes/version
 * Returns installed Hermes CLI version when HERMES_HOME or hermes binary is available.
 * No update check (no public Hermes releases URL); use for display only.
 */
export async function GET() {
  const bin = (process.env.HERMES_BIN || 'hermes-agent').trim() || 'hermes'
  try {
    const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 3000 })
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    const match = out.match(/(\d+\.\d+\.\d+(?:[-.]\w+)?)/)
    const installed = match ? match[1] : (out || null)
    return NextResponse.json(
      {
        installed: installed || null,
        latest: null,
        updateAvailable: false,
        releaseUrl: '',
        releaseNotes: '',
        updateCommand: '',
      },
      { headers }
    )
  } catch {
    return NextResponse.json(
      { installed: null, latest: null, updateAvailable: false, releaseUrl: '', releaseNotes: '', updateCommand: '' },
      { headers }
    )
  }
}

export const dynamic = 'force-dynamic'
