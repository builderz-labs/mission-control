import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const allowedDomains = ['video.twimg.com', 'pbs.twimg.com']

// Simple concurrency limiter
let activeRequests = 0
const MAX_CONCURRENT = 3

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url parameter', { status: 400 })

  let urlObj: URL
  try { urlObj = new URL(url) } catch { return new NextResponse('Invalid URL', { status: 400 }) }
  if (!allowedDomains.includes(urlObj.hostname)) {
    return new NextResponse('Forbidden domain', { status: 403 })
  }

  // Reject if too many in-flight
  if (activeRequests >= MAX_CONCURRENT) {
    return new NextResponse('Too many requests', { status: 429, headers: { 'Retry-After': '2' } })
  }

  activeRequests++
  try {
    // Forward range header for streaming/seeking
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': '*/*',
    }
    const range = request.headers.get('Range')
    if (range) headers['Range'] = range

    const response = await fetch(url, { headers })

    if (!response.ok && response.status !== 206) {
      console.error(`[media-proxy] Failed to fetch ${url}: ${response.status}`)
      return new NextResponse(`Upstream error: ${response.status}`, { status: response.status })
    }

    const resHeaders: Record<string, string> = {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    }

    // Forward range-related headers
    for (const h of ['Content-Length', 'Content-Range']) {
      const v = response.headers.get(h)
      if (v) resHeaders[h] = v
    }

    return new NextResponse(response.body, {
      status: response.status, // 200 or 206
      headers: resHeaders,
    })
  } catch (error) {
    console.error('[media-proxy] Error:', error)
    return new NextResponse('Failed to fetch media', { status: 502 })
  } finally {
    activeRequests--
  }
}
