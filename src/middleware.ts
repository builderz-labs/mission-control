import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Simple token-based authentication for Mission Control
// Token is set via MISSION_CONTROL_TOKEN environment variable

export function middleware(request: NextRequest) {
  // Only allow localhost connections
  const host = request.headers.get('host') || ''
  const forwarded = request.headers.get('x-forwarded-for')
  
  // Block any non-localhost access
  if (!host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  
  // If X-Forwarded-For is set, someone is proxying - block it
  if (forwarded && !forwarded.startsWith('127.0.0.1')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const token = process.env.MISSION_CONTROL_TOKEN
  
  // If no token configured, allow access (localhost-only mode)
  if (!token) {
    return NextResponse.next()
  }

  // Check for auth cookie or query param (for initial auth)
  const authCookie = request.cookies.get('mc_auth')?.value
  const authParam = request.nextUrl.searchParams.get('token')
  
  // Allow access if token matches
  if (authCookie === token || authParam === token) {
    const response = NextResponse.next()
    
    // Set auth cookie if authenticated via query param
    if (authParam === token && !authCookie) {
      response.cookies.set('mc_auth', token, {
        httpOnly: true,
        secure: false, // localhost doesn't use HTTPS
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7 // 7 days
      })
      
      // Redirect to remove token from URL
      const cleanUrl = new URL(request.url)
      cleanUrl.searchParams.delete('token')
      return NextResponse.redirect(cleanUrl)
    }
    
    return response
  }

  // No valid auth - show login prompt
  return new NextResponse(
    `<!DOCTYPE html>
    <html>
      <head>
        <title>Mission Control - Auth Required</title>
        <style>
          body { 
            background: #0a0a0a; 
            color: #fff; 
            font-family: system-ui; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100vh; 
            margin: 0;
          }
          .auth-box {
            background: #1a1a1a;
            padding: 2rem;
            border-radius: 8px;
            border: 1px solid #333;
            text-align: center;
          }
          h1 { margin: 0 0 1rem; font-size: 1.5rem; }
          input {
            background: #0a0a0a;
            border: 1px solid #333;
            color: #fff;
            padding: 0.75rem 1rem;
            border-radius: 4px;
            margin: 0.5rem 0;
            width: 200px;
          }
          button {
            background: #3b82f6;
            color: #fff;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 4px;
            cursor: pointer;
            margin-left: 0.5rem;
          }
          button:hover { background: #2563eb; }
        </style>
      </head>
      <body>
        <div class="auth-box">
          <h1>⚡ Mission Control</h1>
          <p>Authentication required</p>
          <form method="GET">
            <input type="password" name="token" placeholder="Enter token" autofocus />
            <button type="submit">Login</button>
          </form>
        </div>
      </body>
    </html>`,
    { 
      status: 401,
      headers: { 'Content-Type': 'text/html' }
    }
  )
}

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
