'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-3">
            <span className="text-primary-foreground font-bold text-lg">MC</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">Mission Control</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-smooth flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          OpenClaw Agent Orchestration
        </p>
      </div>
    </div>
  )
}
