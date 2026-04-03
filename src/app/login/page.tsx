'use client'

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@/lib/version'

// Lazy-load heavy ReactBits components — no SSR for canvas/animation
const ParticlesBg = dynamic(() => import('@/components/reactbits/particles-bg'), { ssr: false })
const DecryptedText = dynamic(() => import('@/components/reactbits/decrypted-text'), { ssr: false })
const ShinyText = dynamic(() => import('@/components/reactbits/shiny-text'), { ssr: false })

interface GoogleCredentialResponse {
  credential?: string
}

interface GoogleAccountsIdApi {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }): void
  prompt(): void
}

interface GoogleApi {
  accounts: {
    id: GoogleAccountsIdApi
  }
}

type LoginRequestBody =
  | { username: string; password: string }
  | { credential?: string }

type LoginErrorPayload = {
  code?: string
  error?: string
}

function readLoginErrorPayload(value: unknown): LoginErrorPayload {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}

declare global {
  interface Window {
    google?: GoogleApi
  }
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

/* Ultron animated logo with glow ring */
function UltronLogo() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer glow ring */}
      <div className="absolute w-24 h-24 rounded-full border border-primary/20 animate-ping" style={{ animationDuration: '3s' }} />
      <div className="absolute w-20 h-20 rounded-full border border-primary/30 animate-pulse" />
      {/* Core logo */}
      <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-card/90 border border-primary/40 shadow-[0_0_30px_rgba(34,211,238,0.15)] flex items-center justify-center backdrop-blur-sm">
        <Image
          src="/brand/mantu-logo-128.png"
          alt="Ultron"
          width={56}
          height={56}
          className="h-14 w-14 object-cover"
          priority
        />
      </div>
      {/* Status dot — system online */}
      <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-background shadow-[0_0_8px_rgba(52,211,153,0.6)]">
        <div className="w-full h-full rounded-full bg-emerald-400 animate-ping opacity-75" style={{ animationDuration: '2s' }} />
      </div>
    </div>
  )
}

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const [mounted, setMounted] = useState(false)
  const googleCallbackRef = useRef<((response: GoogleCredentialResponse) => void) | null>(null)

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

  useEffect(() => {
    setMounted(true)
  }, [])

  const completeLogin = useCallback(async (path: string, body: LoginRequestBody) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const data = readLoginErrorPayload(await res.json().catch(() => null))
      if (data.code === 'PENDING_APPROVAL') {
        setPendingApproval(true)
        setError('')
        setLoading(false)
        setGoogleLoading(false)
        return false
      }
      setError(data.error || 'Login failed')
      setPendingApproval(false)
      setLoading(false)
      setGoogleLoading(false)
      return false
    }

    window.location.href = '/'
    return true
  }, [])

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await completeLogin('/api/auth/login', { username, password })
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }, [username, password, completeLogin])

  // Google Sign-In SDK
  useEffect(() => {
    if (!googleClientId) return

    const onScriptLoad = () => {
      if (!window.google) return
      googleCallbackRef.current = async (response: GoogleCredentialResponse) => {
        setError('')
        setGoogleLoading(true)
        try {
          const ok = await completeLogin('/api/auth/google', { credential: response?.credential })
          if (!ok) return
        } catch {
          setError('Google sign-in failed')
          setGoogleLoading(false)
        }
      }
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: GoogleCredentialResponse) => googleCallbackRef.current?.(response),
      })
      setGoogleReady(true)
    }

    const existing = document.querySelector('script[data-google-gsi="1"]') as HTMLScriptElement | null
    if (existing) {
      if (window.google) onScriptLoad()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.setAttribute('data-google-gsi', '1')
    script.onload = onScriptLoad
    script.onerror = () => setError('Failed to load Google Sign-In')
    document.head.appendChild(script)
  }, [googleClientId, completeLogin])

  const handleGoogleSignIn = () => {
    if (!window.google || !googleReady) return
    window.google.accounts.id.prompt()
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#07090C] overflow-hidden">
      {/* Animated particle field background */}
      <div className="absolute inset-0 z-0">
        <ParticlesBg
          particleCount={60}
          colors={['#22D3EE', '#3B82F6', '#A78BFA', '#34D399']}
          speed={0.6}
          connectDistance={140}
        />
      </div>

      {/* Radial gradient overlay for depth */}
      <div className="absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(7,9,12,0.6)_50%,rgba(7,9,12,0.95)_100%)]" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 z-[2] opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(34,211,238,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.3) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Login card */}
      <div
        className={`relative z-10 w-full max-w-sm transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      >
        {/* Glass card */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl shadow-2xl shadow-primary/5 p-8">
          {/* Logo + Title */}
          <div className="flex flex-col items-center mb-8">
            <UltronLogo />

            <div className="mt-6 text-center">
              <h1 className="text-xl font-semibold text-foreground tracking-wide">
                {mounted ? (
                  <DecryptedText
                    text="ULTRON MISSION CONTROL"
                    speed={40}
                    maxIterations={15}
                    sequential
                    revealDirection="center"
                    className="text-foreground"
                    encryptedClassName="text-primary/60"
                    animateOn="view"
                  />
                ) : (
                  'ULTRON MISSION CONTROL'
                )}
              </h1>
              <div className="mt-2 h-5">
                {mounted ? (
                  <ShinyText
                    text="Built by Tony W. for Mantu Group"
                    speed={3}
                    className="text-sm"
                    color="#6b7280a0"
                    shineColor="#22D3EE"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">Built by Tony W. for Mantu Group</span>
                )}
              </div>
            </div>
          </div>

          {/* Pending Approval */}
          {pendingApproval && (
            <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
              <div className="flex justify-center mb-2">
                <svg className="w-8 h-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12,6 12,12 16,14" />
                </svg>
              </div>
              <div className="text-sm font-medium text-amber-200">Access Request Submitted</div>
              <p className="text-xs text-muted-foreground mt-1">
                Your request has been sent to an administrator for review. You&apos;ll be able to sign in once approved.
              </p>
              <Button
                onClick={() => { setPendingApproval(false); setError(''); setGoogleLoading(false) }}
                variant="ghost"
                size="sm"
                className="mt-3 text-xs"
              >
                Try again
              </Button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div role="alert" className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.25a.75.75 0 110-1.5.75.75 0 010 1.5z" />
              </svg>
              {error}
            </div>
          )}

          {/* Google Sign-In */}
          {googleClientId && (
            <div className={pendingApproval ? 'opacity-50 pointer-events-none' : ''}>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={!googleReady || googleLoading || loading}
                className="w-full h-10 flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 text-foreground text-sm font-medium hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
              >
                {googleLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <GoogleIcon className="w-[18px] h-[18px]" />
                    Sign in with Google
                  </>
                )}
              </button>
              {!googleReady && (
                <p className="text-center text-xs text-muted-foreground mt-2">Loading Google Sign-In...</p>
              )}
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <span className="text-xs text-muted-foreground/60 uppercase tracking-widest">or</span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className={`space-y-4 ${pendingApproval ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <label htmlFor="username" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-white/[0.04] border border-white/[0.08] text-foreground text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all duration-200 hover:border-white/[0.15]"
                placeholder="admin"
                autoComplete="username"
                autoFocus
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-4 rounded-xl bg-white/[0.04] border border-white/[0.08] text-foreground text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-all duration-200 hover:border-white/[0.15]"
                placeholder="Enter password"
                autoComplete="current-password"
                required
                aria-required="true"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="w-full h-11 rounded-xl bg-primary/90 hover:bg-primary text-primary-foreground font-medium shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all duration-200"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Authenticating...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="7" width="10" height="7" rx="1.5" />
                    <path d="M5 7V5a3 3 0 016 0v2" />
                  </svg>
                  Sign in to Ultron
                </div>
              )}
            </Button>
          </form>

          {/* System status footer */}
          <div className="mt-6 pt-4 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-muted-foreground/40">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 shadow-[0_0_4px_rgba(52,211,153,0.5)]" />
              System Online
            </span>
            <span>v{APP_VERSION}</span>
            <span className="uppercase tracking-wider">Secure</span>
          </div>
        </div>
      </div>
    </div>
  )
}
