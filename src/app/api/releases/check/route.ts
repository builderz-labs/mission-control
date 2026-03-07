import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { APP_VERSION } from '@/lib/version'

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/builderz-labs/mission-control/releases/latest'

/** Simple semver compare: returns 1 if a > b, -1 if a < b, 0 if equal. */
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

export async function GET() {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 }, // ISR cache for 1 hour
    })

    if (!res.ok) {
      return NextResponse.json(
        { updateAvailable: false, currentVersion: APP_VERSION },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      )
    }

    const release = await res.json()
    const latestVersion = (release.tag_name ?? '').replace(/^v/, '')
    const updateAvailable = compareSemver(latestVersion, APP_VERSION) > 0

    const deploymentMode = existsSync('/.dockerenv') ? 'docker' : 'bare-metal'

    return NextResponse.json(
      {
        updateAvailable,
        currentVersion: APP_VERSION,
        latestVersion,
        releaseUrl: release.html_url ?? '',
        releaseNotes: release.body ?? '',
        deploymentMode,
      },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    )
  } catch {
    // Network error — fail gracefully
    return NextResponse.json(
      { updateAvailable: false, currentVersion: APP_VERSION },
      { headers: { 'Cache-Control': 'public, max-age=600' } }
    )
  }
}
