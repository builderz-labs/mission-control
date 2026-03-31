import { NextResponse } from 'next/server'
import { runOpenClaw } from '@/lib/command'

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/openclaw/openclaw/releases/latest'

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

const headers = { 'Cache-Control': 'no-store' }

export async function GET() {
  let installed: string | null = null

  try {
    const result = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    const match = result.stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) installed = match[1]
  } catch {
    // OpenClaw not installed or not reachable
    return NextResponse.json(
      { installed: null, latest: null, updateAvailable: false },
      { headers }
    )
  }

  if (!installed) {
    return NextResponse.json(
      { installed: null, latest: null, updateAvailable: false },
      { headers }
    )
  }

  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      return NextResponse.json(
        { installed, latest: null, updateAvailable: false },
        { headers }
      )
    }

    const release = await res.json()
    const latest = (release.tag_name ?? '').replace(/^v/, '')
    const updateAvailable = compareSemver(latest, installed) > 0

    return NextResponse.json(
      {
        installed,
        latest,
        updateAvailable,
        releaseUrl: release.html_url ?? '',
        releaseNotes: release.body ?? '',
        updateCommand: 'openclaw update --channel stable',
      },
      { headers }
    )
  } catch {
    return NextResponse.json(
      { installed, latest: null, updateAvailable: false },
      { headers }
    )
  }
}
