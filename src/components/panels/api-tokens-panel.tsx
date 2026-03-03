'use client'

import { useState, useEffect, useCallback } from 'react'

interface ApiToken {
  id: number
  name: string
  token_prefix: string
  role: string
  created_by: string
  last_used_at: number | null
  expires_at: number | null
  revoked_at: number | null
  created_at: number
}

export function ApiTokensPanel() {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null)
  const [rotatedTokenValue, setRotatedTokenValue] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/tokens')
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to fetch tokens')
        return
      }
      const data = await res.json()
      setTokens(data.tokens || [])
      setError('')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  async function handleCreate(form: { name: string; role: string; expires_in_days: number | null }) {
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setNewTokenValue(data.token)
      setShowCreate(false)
      fetchTokens()
    } catch { setError('Failed to create token') }
  }

  async function handleRevoke(id: number) {
    setProcessingId(id)
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'revoke' }),
      })
      if (res.ok) fetchTokens()
      else {
        const data = await res.json()
        setError(data.error || 'Failed to revoke')
      }
    } catch { setError('Network error') }
    finally { setProcessingId(null) }
  }

  async function handleRotate(id: number) {
    setProcessingId(id)
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'rotate' }),
      })
      const data = await res.json()
      if (res.ok) {
        setRotatedTokenValue(data.token)
        fetchTokens()
      } else {
        setError(data.error || 'Failed to rotate')
      }
    } catch { setError('Network error') }
    finally { setProcessingId(null) }
  }

  function formatDate(ts: number | null) {
    if (!ts) return 'Never'
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  function getStatus(token: ApiToken): { label: string; color: string } {
    if (token.revoked_at) return { label: 'Revoked', color: 'text-red-400 bg-red-500/10' }
    if (token.expires_at && token.expires_at < Math.floor(Date.now() / 1000)) return { label: 'Expired', color: 'text-amber-400 bg-amber-500/10' }
    return { label: 'Active', color: 'text-green-400 bg-green-500/10' }
  }

  const activeTokens = tokens.filter(t => !t.revoked_at && (!t.expires_at || t.expires_at > Math.floor(Date.now() / 1000)))
  const inactiveTokens = tokens.filter(t => t.revoked_at || (t.expires_at && t.expires_at <= Math.floor(Date.now() / 1000)))

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">API Tokens</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeTokens.length} active token{activeTokens.length !== 1 ? 's' : ''}
            {inactiveTokens.length > 0 && ` · ${inactiveTokens.length} revoked/expired`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth"
        >
          + New Token
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-muted-foreground hover:text-foreground">×</button>
        </div>
      )}

      {/* New token reveal */}
      {newTokenValue && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-green-400">New API Token (save now — shown only once)</p>
          <code className="block text-xs font-mono bg-secondary rounded px-2 py-1.5 text-foreground break-all select-all">
            {newTokenValue}
          </code>
          <div className="flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(newTokenValue); }}
              className="text-xs text-primary hover:text-primary/80 font-medium transition-smooth"
            >
              Copy to clipboard
            </button>
            <button
              onClick={() => setNewTokenValue(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition-smooth"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Rotated token reveal */}
      {rotatedTokenValue && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-400">Rotated API Token (save now — shown only once)</p>
          <p className="text-2xs text-muted-foreground">The old token has been revoked. Use this new token instead.</p>
          <code className="block text-xs font-mono bg-secondary rounded px-2 py-1.5 text-foreground break-all select-all">
            {rotatedTokenValue}
          </code>
          <div className="flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(rotatedTokenValue); }}
              className="text-xs text-primary hover:text-primary/80 font-medium transition-smooth"
            >
              Copy to clipboard
            </button>
            <button
              onClick={() => setRotatedTokenValue(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition-smooth"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <CreateTokenForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Token list */}
      <div className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-lg shimmer" />)}
          </div>
        ) : tokens.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-xs text-muted-foreground">No API tokens created</p>
            <p className="text-2xs text-muted-foreground/60 mt-1">
              Create tokens to authenticate API requests without session cookies
            </p>
          </div>
        ) : (
          tokens.map((t) => {
            const status = getStatus(t)
            const isActive = !t.revoked_at && (!t.expires_at || t.expires_at > Math.floor(Date.now() / 1000))

            return (
              <div key={t.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{t.name}</span>
                      <span className={`text-2xs font-medium px-1.5 py-0.5 rounded ${status.color}`}>
                        {status.label}
                      </span>
                      <span className="text-2xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                        {t.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-2xs text-muted-foreground">
                      <span className="font-mono">{t.token_prefix}••••••</span>
                      <span>by {t.created_by}</span>
                      {t.last_used_at && <span>Used {formatDate(t.last_used_at)}</span>}
                      {t.expires_at && <span>Expires {formatDate(t.expires_at)}</span>}
                      <span>Created {formatDate(t.created_at)}</span>
                    </div>
                  </div>

                  {isActive && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRotate(t.id)}
                        disabled={processingId === t.id}
                        className="h-7 px-2 text-2xs font-medium text-amber-400 hover:bg-amber-500/10 rounded transition-smooth disabled:opacity-50"
                        title="Rotate: revoke this token and generate a new one"
                      >
                        {processingId === t.id ? '...' : 'Rotate'}
                      </button>
                      <button
                        onClick={() => handleRevoke(t.id)}
                        disabled={processingId === t.id}
                        className="h-7 px-2 text-2xs font-medium text-red-400 hover:bg-red-500/10 rounded transition-smooth disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Legacy env var notice */}
      {process.env.NEXT_PUBLIC_HAS_LEGACY_API_KEY === 'true' && (
        <div className="rounded-lg border border-border bg-secondary/30 p-3 text-2xs text-muted-foreground">
          <strong className="text-foreground">Legacy API key active:</strong> The <code className="font-mono">API_KEY</code> environment variable
          is still accepted for backwards compatibility. Consider migrating to managed tokens above.
        </div>
      )}
    </div>
  )
}

function CreateTokenForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (form: { name: string; role: string; expires_in_days: number | null }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('operator')
  const [expiryOption, setExpiryOption] = useState<string>('never')

  const expiryDays: Record<string, number | null> = {
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
    'never': null,
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">New API Token</h3>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CI/CD pipeline"
          className="w-full h-8 px-2.5 rounded-md bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Role</label>
        <div className="flex gap-1.5">
          {['viewer', 'operator', 'admin'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`h-7 px-3 rounded text-2xs font-medium transition-smooth ${
                role === r
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Expiration</label>
        <div className="flex gap-1.5 flex-wrap">
          {Object.keys(expiryDays).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setExpiryOption(opt)}
              className={`h-7 px-3 rounded text-2xs font-medium transition-smooth ${
                expiryOption === opt
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt === 'never' ? 'No expiration' : opt}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 h-8 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-smooth"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ name, role, expires_in_days: expiryDays[expiryOption] })}
          disabled={!name.trim()}
          className="flex-1 h-8 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth disabled:opacity-50"
        >
          Create Token
        </button>
      </div>
    </div>
  )
}
