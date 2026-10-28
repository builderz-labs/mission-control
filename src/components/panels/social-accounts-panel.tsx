'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { apiFetch, ApiError } from '@/lib/api-client'

type Provider = 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'reddit'

interface OAuthAppConfig {
  provider: Provider
  configured: boolean
  client_id: string | null
  redirect_uri: string | null
  scopes: string[]
  options: Record<string, string | boolean>
  status: string
  configured_at: number | null
}

interface SocialAccount {
  account_id: string
  provider: Provider
  account_ref: string
  external_account_id: string | null
  account_mode: string | null
  status: 'PENDING' | 'CONNECTED' | 'EXPIRED' | 'REAUTH_REQUIRED' | 'DISCONNECTED'
  scopes: string
  expires_at: number | null
  refreshable: number
}

interface Draft {
  client_id: string
  client_secret: string
  redirect_uri: string
  scopes: string
  pkce_enabled: boolean
  reddit_duration: 'temporary' | 'permanent'
  reddit_user_agent: string
}

const PROVIDERS: Array<{
  id: Provider
  label: string
  description: string
  secretMode: 'required' | 'optional' | 'none'
  loginRequirement: string
}> = [
  {
    id: 'instagram',
    label: 'Instagram',
    description: 'Professional (Business/Creator) account via Instagram Login.',
    secretMode: 'required',
    loginRequirement: 'Meta developer app + Instagram Professional account',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    description: 'Login Kit v2 with PKCE; analytics uses user.info.basic + video.list.',
    secretMode: 'required',
    loginRequirement: 'TikTok developer app with Login Kit enabled',
  },
  {
    id: 'x',
    label: 'X',
    description: 'OAuth 2.0 Authorization Code + PKCE with offline.access.',
    secretMode: 'none',
    loginRequirement: 'X developer app with OAuth 2.0 enabled',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    description: '3-legged OAuth; PKCE can be used when the LinkedIn app supports it.',
    secretMode: 'optional',
    loginRequirement: 'LinkedIn app with the analytics scopes you have approval for',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    description: 'OAuth2 permanent authorization with a descriptive User-Agent.',
    secretMode: 'required',
    loginRequirement: 'Reddit developer app + Reddit account',
  },
]

function splitScopes(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function defaultRedirect(provider: Provider): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api/marketing/social-oauth/${provider}/callback`
}

function initialDraft(app: OAuthAppConfig): Draft {
  return {
    client_id: app.client_id || '',
    client_secret: '',
    redirect_uri: app.redirect_uri || defaultRedirect(app.provider),
    scopes: app.scopes.join(' '),
    pkce_enabled: app.provider === 'linkedin' ? app.options.pkce_enabled !== false : false,
    reddit_duration: app.provider === 'reddit' && app.options.duration === 'temporary' ? 'temporary' : 'permanent',
    reddit_user_agent: app.provider === 'reddit' && typeof app.options.user_agent === 'string'
      ? app.options.user_agent
      : 'windows:ai-ops-hub:v0.1 (by /u/your_username)',
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : 'Request failed'
}

export function SocialAccountsPanel() {
  const searchParams = useSearchParams()
  const [apps, setApps] = useState<OAuthAppConfig[]>([])
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Provider | null>(null)
  const [starting, setStarting] = useState<Provider | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const oauthNotice = useMemo(() => {
    const state = searchParams.get('oauth')
    const provider = searchParams.get('provider')
    if (!state) return null
    if (state === 'success') return { ok: true, text: `${provider || 'Social'} authorization returned successfully. Account verification is pending.` }
    if (state === 'cancelled') return { ok: false, text: `${provider || 'Social'} authorization was cancelled.` }
    return { ok: false, text: `${provider || 'Social'} authorization could not be completed. Start a fresh authorization attempt.` }
  }, [searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [appsResult, accountsResult] = await Promise.all([
        apiFetch<{ apps: OAuthAppConfig[] }>('/api/marketing/social-oauth/apps'),
        apiFetch<{ accounts: SocialAccount[] }>('/api/marketing/social-accounts'),
      ])
      setApps(appsResult.apps || [])
      setAccounts(accountsResult.accounts || [])
      setDrafts((previous) => {
        const next = { ...previous }
        for (const app of appsResult.apps || []) {
          if (!next[app.provider]) next[app.provider] = initialDraft(app)
        }
        return next
      })
    } catch (error) {
      setFeedback({ ok: false, text: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const updateDraft = (provider: Provider, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [provider]: { ...(current[provider] || initialDraft(apps.find((app) => app.provider === provider)!)), ...patch },
    }))
  }

  const saveProvider = async (provider: Provider) => {
    const draft = drafts[provider]
    if (!draft) return
    setSaving(provider)
    setFeedback(null)
    try {
      const options: Record<string, string | boolean> = {}
      if (provider === 'linkedin') options.pkce_enabled = draft.pkce_enabled
      if (provider === 'reddit') {
        options.duration = draft.reddit_duration
        options.user_agent = draft.reddit_user_agent.trim()
      }
      await apiFetch('/api/marketing/social-oauth/apps', {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          client_id: draft.client_id.trim(),
          ...(draft.client_secret ? { client_secret: draft.client_secret } : {}),
          redirect_uri: draft.redirect_uri.trim(),
          scopes: splitScopes(draft.scopes),
          options,
        }),
      })
      setFeedback({ ok: true, text: `${provider} OAuth app configuration saved securely.` })
      setDrafts((current) => ({
        ...current,
        [provider]: { ...current[provider], client_secret: '' },
      }))
      await load()
    } catch (error) {
      setFeedback({ ok: false, text: errorMessage(error) })
    } finally {
      setSaving(null)
    }
  }

  const startLogin = async (provider: Provider) => {
    setStarting(provider)
    setFeedback(null)
    try {
      const result = await apiFetch<{ authorize_url: string; scopes: string[]; expires_at: number }>(
        `/api/marketing/social-oauth/${provider}/start`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      // This is the explicit boundary: navigation below starts the real provider login.
      window.location.assign(result.authorize_url)
    } catch (error) {
      setFeedback({ ok: false, text: errorMessage(error) })
      setStarting(null)
    }
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setFeedback({ ok: true, text: 'Copied to clipboard.' })
    } catch {
      setFeedback({ ok: false, text: 'Clipboard access failed.' })
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading social account configuration…</span>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Social Accounts</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configure provider apps securely. Nothing opens an external login until you press Connect.
        </p>
      </div>

      {(oauthNotice || feedback) && (
        <div className={`rounded-lg border p-3 text-xs ${(feedback || oauthNotice)?.ok
          ? 'border-green-500/30 bg-green-500/10 text-green-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
          {(feedback || oauthNotice)?.text}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium text-foreground">Login boundary</div>
        <p className="text-xs text-muted-foreground mt-1">
          Everything on this screen is local configuration. The Connect button is the first action that leaves Control Tower
          for the provider consent page.
        </p>
      </div>

      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const app = apps.find((item) => item.provider === provider.id)
          if (!app) return null
          const draft = drafts[provider.id] || initialDraft(app)
          const providerAccounts = accounts.filter((account) => account.provider === provider.id)
          const connected = providerAccounts.find((account) => account.status === 'CONNECTED')
          const pending = providerAccounts.find((account) => account.status === 'PENDING')
          const scopes = splitScopes(draft.scopes)
          const linkedInScopesMissing = provider.id === 'linkedin' && scopes.length === 0
          const redditUaPlaceholder = provider.id === 'reddit' && /your_username/.test(draft.reddit_user_agent)
          const readyToConnect = app.configured && !linkedInScopesMissing && !redditUaPlaceholder

          return (
            <section key={provider.id} className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{provider.label}</h3>
                    <span className={`text-2xs rounded-full px-2 py-0.5 ${connected
                      ? 'bg-green-500/15 text-green-400'
                      : pending
                        ? 'bg-amber-500/15 text-amber-300'
                        : app.configured
                          ? 'bg-blue-500/15 text-blue-300'
                          : 'bg-muted text-muted-foreground'}`}>
                      {connected ? 'Connected' : pending ? 'Pending verification' : app.configured ? 'Ready for login' : 'Not configured'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{provider.description}</p>
                  <p className="text-2xs text-muted-foreground/70 mt-1">Prerequisite: {provider.loginRequirement}</p>
                </div>
                <Button
                  size="sm"
                  variant={readyToConnect ? 'default' : 'secondary'}
                  disabled={!readyToConnect || starting === provider.id}
                  onClick={() => void startLogin(provider.id)}
                >
                  {starting === provider.id ? 'Preparing…' : connected ? 'Reconnect' : 'Connect'}
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-2xs text-muted-foreground">Client ID / App ID</span>
                  <input
                    value={draft.client_id}
                    onChange={(event) => updateDraft(provider.id, { client_id: event.target.value })}
                    className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs font-mono"
                    autoComplete="off"
                  />
                </label>
                {provider.secretMode !== 'none' && (
                  <label className="space-y-1">
                    <span className="text-2xs text-muted-foreground">
                      Client Secret {provider.secretMode === 'optional' ? '(optional with PKCE)' : ''}
                    </span>
                    <input
                      type="password"
                      value={draft.client_secret}
                      onChange={(event) => updateDraft(provider.id, { client_secret: event.target.value })}
                      placeholder={app.configured ? 'Leave blank to keep stored secret' : 'Enter secret'}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs font-mono"
                      autoComplete="new-password"
                      data-1p-ignore
                    />
                  </label>
                )}
              </div>

              <label className="space-y-1 block">
                <span className="text-2xs text-muted-foreground">Redirect URI — register this exact value in the provider developer app</span>
                <div className="flex gap-2">
                  <input
                    value={draft.redirect_uri}
                    onChange={(event) => updateDraft(provider.id, { redirect_uri: event.target.value })}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs font-mono"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyText(draft.redirect_uri)}>
                    Copy
                  </Button>
                </div>
              </label>

              <label className="space-y-1 block">
                <span className="text-2xs text-muted-foreground">Requested scopes</span>
                <input
                  value={draft.scopes}
                  onChange={(event) => updateDraft(provider.id, { scopes: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs font-mono"
                  placeholder={provider.id === 'linkedin' ? 'Enter only scopes approved for your LinkedIn app' : ''}
                />
              </label>

              {provider.id === 'linkedin' && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draft.pkce_enabled}
                    onChange={(event) => updateDraft(provider.id, { pkce_enabled: event.target.checked })}
                  />
                  Use PKCE mode (no client secret when your LinkedIn app supports it)
                </label>
              )}

              {provider.id === 'reddit' && (
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-2xs text-muted-foreground">Authorization duration</span>
                    <select
                      value={draft.reddit_duration}
                      onChange={(event) => updateDraft(provider.id, { reddit_duration: event.target.value as 'temporary' | 'permanent' })}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                    >
                      <option value="permanent">permanent</option>
                      <option value="temporary">temporary</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-2xs text-muted-foreground">User-Agent</span>
                    <input
                      value={draft.reddit_user_agent}
                      onChange={(event) => updateDraft(provider.id, { reddit_user_agent: event.target.value })}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs font-mono"
                    />
                  </label>
                </div>
              )}

              {(linkedInScopesMissing || redditUaPlaceholder) && (
                <div className="text-2xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 p-2.5">
                  {linkedInScopesMissing
                    ? 'LinkedIn: add only scopes that your LinkedIn app has actually been approved to use before connecting.'
                    : 'Reddit: replace /u/your_username with the real Reddit account name before connecting.'}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-2xs text-muted-foreground">
                  {app.configured
                    ? 'Secret material is already protected in the Windows DPAPI vault. Blank secret fields do not overwrite it.'
                    : 'Saving validates the configuration and protects secret material with Windows DPAPI.'}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving === provider.id}
                  onClick={() => void saveProvider(provider.id)}
                >
                  {saving === provider.id ? 'Saving…' : app.configured ? 'Update configuration' : 'Save configuration'}
                </Button>
              </div>
            </section>
          )
        })}
      </div>

      {accounts.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Account registry</h3>
          <div className="mt-3 space-y-2">
            {accounts.map((account) => (
              <div key={account.account_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-foreground">{account.provider} · {account.account_ref}</div>
                  <div className="text-2xs text-muted-foreground">
                    {account.status} · {account.refreshable ? 'refreshable' : 'no refresh token'}
                    {account.expires_at ? ` · expires ${new Date(account.expires_at * 1000).toLocaleString()}` : ''}
                  </div>
                </div>
                <span className="text-2xs font-mono text-muted-foreground">{account.account_id.slice(0, 8)}…</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
