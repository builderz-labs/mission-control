import { NextResponse } from 'next/server'
import { issueDesktopBrowserLogin } from '@/lib/desktop-browser-login'
import { desktopBrowserRequestLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  const rateCheck = desktopBrowserRequestLimiter(request)
  if (rateCheck) return rateCheck
  try {
    const login = issueDesktopBrowserLogin()
    return NextResponse.json({
      request_id: login.requestId,
      code: login.code,
      expires_at: login.expiresAt,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error({ err: error }, 'Desktop browser login request failed')
    return NextResponse.json(
      { error: 'Desktop browser sign-in is unavailable' },
      { status: 503 },
    )
  }
}
