import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { runCommand } from '@/lib/command'

const DEFAULT_DOWNLOAD_URL = 'https://flightdeck.example.com/download'
const DEFAULT_INSTALL_PATHS = [
  '/Applications/Flight Deck.app',
  '/Applications/Flight Desk.app',
]

function getConfiguredFlightDeckPath(): string | null {
  const fromEnv = String(process.env.FLIGHT_DECK_PATH || '').trim()
  return fromEnv || null
}

function getFlightDeckBaseUrl(): string {
  const fromEnv = String(process.env.FLIGHT_DECK_URL || '').trim()
  if (fromEnv) return fromEnv
  return 'http://127.0.0.1:4177'
}

function getFlightDeckLaunchUrl(): string {
  const fromEnv = String(process.env.FLIGHT_DECK_LAUNCH_URL || '').trim()
  if (fromEnv) return fromEnv
  return 'flightdeck://open'
}

function isInstalled(targetPath: string): boolean {
  try {
    return existsSync(targetPath) && statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

function resolveFlightDeckInstallPath(): string | null {
  const configured = getConfiguredFlightDeckPath()
  if (configured && isInstalled(configured)) return configured
  for (const candidate of DEFAULT_INSTALL_PATHS) {
    if (isInstalled(candidate)) return candidate
  }
  return configured
}

/**
 * GET /api/local/flight-deck
 * Check Flight Deck local installation status.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const installPath = resolveFlightDeckInstallPath()
  const installed = installPath ? isInstalled(installPath) : false

  return NextResponse.json({
    installed,
    installPath: installPath || null,
    appUrl: getFlightDeckBaseUrl(),
    downloadUrl: DEFAULT_DOWNLOAD_URL,
  })
}

/**
 * POST /api/local/flight-deck
 * Build a Flight Deck URL for the selected agent/session.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const installPath = resolveFlightDeckInstallPath()
  const installed = installPath ? isInstalled(installPath) : false
  if (!installed) {
    return NextResponse.json({
      installed: false,
      error: 'Flight Deck is not installed locally.',
      installPath: installPath || null,
      downloadUrl: DEFAULT_DOWNLOAD_URL,
    }, { status: 404 })
  }

  // Body is optional — agent/session params default to empty (opens Flight Deck without context)
  const body = await request.json().catch(() => ({}))
  const agent = typeof body?.agent === 'string' ? body.agent : ''
  const session = typeof body?.session === 'string' ? body.session : ''

  const webUrl = new URL(getFlightDeckBaseUrl())
  webUrl.searchParams.set('source', 'mission-control')
  if (agent) webUrl.searchParams.set('agent', agent)
  if (session) webUrl.searchParams.set('session', session)

  const launchUrl = new URL(getFlightDeckLaunchUrl())
  launchUrl.searchParams.set('source', 'mission-control')
  if (agent) launchUrl.searchParams.set('agent', agent)
  if (session) launchUrl.searchParams.set('session', session)

  try {
    // Launch the native app directly; pass deep-link as payload.
    await runCommand('open', ['-a', installPath!, launchUrl.toString()], { timeoutMs: 10_000 })
  } catch (error: any) {
    try {
      // Fallback for apps registered as URL handlers.
      await runCommand('open', [launchUrl.toString()], { timeoutMs: 10_000 })
    } catch (fallbackError: any) {
      return NextResponse.json({
        installed: true,
        launched: false,
        error: fallbackError?.message || error?.message || 'Failed to launch Flight Deck app.',
        fallbackUrl: webUrl.toString(),
        downloadUrl: DEFAULT_DOWNLOAD_URL,
      }, { status: 500 })
    }
  }

  return NextResponse.json({
    installed: true,
    launched: true,
    url: webUrl.toString(),
    launchUrl: launchUrl.toString(),
  })
}

export const dynamic = 'force-dynamic'
