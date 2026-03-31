import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { APP_VERSION } from '@/lib/version'
import { assessReleaseAutoUpdateSafety } from '@/lib/repo-update-safety'

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

const EXEC_OPTS = {
  timeout: 10_000,
  maxBuffer: 1024 * 1024,
  encoding: 'utf-8' as const,
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { ...EXEC_OPTS, cwd }).trim()
}

function getAutoUpdateAssessment(cwd: string) {
  try {
    const dirty = Boolean(git(['status', '--porcelain'], cwd))
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const detached = branch === 'HEAD'
    const remoteUrl = git(['remote', 'get-url', 'origin'], cwd)

    let ahead = 0
    let behind = 0
    try {
      const counts = git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], cwd)
      const [behindRaw, aheadRaw] = counts.split(/\s+/)
      behind = Number(behindRaw || 0)
      ahead = Number(aheadRaw || 0)
    } catch {
      ahead = 0
      behind = 0
    }

    return assessReleaseAutoUpdateSafety({
      dirty,
      remoteUrl,
      branch: detached ? null : branch,
      detached,
      ahead,
      behind,
    })
  } catch {
    return {
      safe: false,
      reason: 'Automatic updates are disabled because Mission Control could not verify the local repository state.',
    }
  }
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
    const autoUpdate = getAutoUpdateAssessment(process.cwd())

    return NextResponse.json(
      {
        updateAvailable,
        currentVersion: APP_VERSION,
        latestVersion,
        releaseUrl: release.html_url ?? '',
        releaseNotes: release.body ?? '',
        deploymentMode,
        autoUpdateSafe: autoUpdate.safe,
        manualOnlyReason: autoUpdate.reason,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    // Network error — fail gracefully
    return NextResponse.json(
      { updateAvailable: false, currentVersion: APP_VERSION },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
