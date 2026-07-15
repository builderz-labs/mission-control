'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { apiFetch, ApiError } from '@/lib/api-client'

type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'
type FixSafety = 'safe' | 'requires-restart' | 'requires-review' | 'manual-only'

interface Check {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
  severity?: CheckSeverity
  fixSafety?: FixSafety
}

interface Category {
  score: number
  checks: Check[]
}

interface ScanResult {
  overall: 'secure' | 'hardened' | 'needs-attention' | 'at-risk'
  score: number
  timestamp: number
  categories: {
    credentials: Category
    network: Category
    openclaw: Category
    runtime: Category
    os: Category
  }
}

interface FixResponse {
  attempted?: number
  fixed?: number
  failed?: number
  remaining?: number
  remainingAutoFixable?: number
  remainingManual?: number
  note?: string
  error?: string
}

function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHENTICATED' || error.code === 'FORBIDDEN') return 'Admin access required'
    return error.message || fallback
  }
  return error instanceof Error ? error.message : fallback
}

// Check IDs that the /api/security-scan/fix endpoint can auto-fix, with safety levels
const FIX_SAFETY: Record<string, FixSafety> = {
  env_permissions: 'safe', config_permissions: 'safe', world_writable: 'safe',
  hsts_enabled: 'requires-restart', cookie_secure: 'requires-restart',
  allowed_hosts: 'requires-restart', rate_limiting: 'requires-restart', api_key_set: 'requires-restart',
  log_redaction: 'requires-restart', dm_isolation: 'requires-restart',
  fs_workspace_only: 'requires-restart',
  exec_restricted: 'requires-review', gateway_auth: 'requires-review',
  gateway_bind: 'requires-review', elevated_disabled: 'requires-review',
  control_ui_device_auth: 'requires-review', control_ui_insecure_auth: 'requires-review',
}

const FIXABLE_IDS = new Set(Object.keys(FIX_SAFETY))

const SEVERITY_BADGE: Record<CheckSeverity, { label: string; className: string }> = {
  critical: { label: 'C', className: 'bg-red-500/20 text-red-400' },
  high: { label: 'H', className: 'bg-orange-500/20 text-orange-400' },
  medium: { label: 'M', className: 'bg-amber-500/20 text-amber-400' },
  low: { label: 'L', className: 'bg-blue-500/20 text-blue-300' },
}

const STATUS_ICON: Record<string, string> = {
  pass: '+',
  fail: 'x',
  warn: '!',
}

const STATUS_COLOR: Record<string, string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  warn: 'text-amber-400',
}

const OVERALL_COLOR: Record<string, string> = {
  hardened: 'text-green-400',
  secure: 'text-green-300',
  'needs-attention': 'text-amber-400',
  'at-risk': 'text-red-400',
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  credentials: { label: 'Credentials', icon: 'K' },
  network: { label: 'Network', icon: 'N' },
  openclaw: { label: 'OpenClaw', icon: 'O' },
  runtime: { label: 'Runtime', icon: 'R' },
  os: { label: 'OS Security', icon: 'S' },
}

export function SecurityScanCard({ compact = false, autoScan = false }: { compact?: boolean; autoScan?: boolean }) {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [copiedFix, setCopiedFix] = useState<string | null>(null)
  const [fixing, setFixing] = useState<string | null>(null) // 'all' or a check id
  const [fixResult, setFixResult] = useState<{
    attempted: number
    fixed: number
    failed: number
    remaining: number
    remainingAutoFixable: number
    remainingManual: number
    note?: string
  } | null>(null)

  const copyFix = useCallback(async (fix: string, checkId: string) => {
    try {
      await navigator.clipboard.writeText(fix)
      setCopiedFix(checkId)
      setTimeout(() => setCopiedFix(null), 2000)
    } catch {
      // Fallback
      const el = document.createElement('textarea')
      el.value = fix
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopiedFix(checkId)
      setTimeout(() => setCopiedFix(null), 2000)
    }
  }, [])

  const runScan = useCallback(async (preserveFixResult = false) => {
    setLoading(true)
    setError(null)
    if (!preserveFixResult) setFixResult(null)
    try {
      setResult(await apiFetch<ScanResult>('/api/security-scan'))
    } catch (err) {
      setError(requestErrorMessage(err, 'Scan failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  const runFix = useCallback(async (ids?: string[]) => {
    const fixKey = ids?.length === 1 ? ids[0] : 'all'
    setFixing(fixKey)
    setFixResult(null)
    try {
      const res = await apiFetch<Response>('/api/security-scan/fix', {
        method: 'POST',
        body: ids ? JSON.stringify({ ids }) : '{}',
        raw: true,
      })
      const data = await res.json().catch(() => ({})) as FixResponse
      if (!res.ok) {
        setFixResult({ attempted: 0, fixed: 0, failed: 1, remaining: 0, remainingAutoFixable: 0, remainingManual: 0, note: data.error || 'Fix failed' })
        return
      }
      setFixResult({
        attempted: data.attempted ?? (data.fixed ?? 0) + (data.failed ?? 0),
        fixed: data.fixed ?? 0,
        failed: data.failed ?? 0,
        remaining: data.remaining ?? 0,
        remainingAutoFixable: data.remainingAutoFixable ?? 0,
        remainingManual: data.remainingManual ?? 0,
        note: data.note,
      })
      await runScan(true)
    } catch (err) {
      setFixResult({ attempted: 0, fixed: 0, failed: 1, remaining: 0, remainingAutoFixable: 0, remainingManual: 0, note: requestErrorMessage(err, 'Fix failed') })
    } finally {
      setFixing(null)
    }
  }, [runScan])

  useEffect(() => {
    if (autoScan && !result && !loading && !error) {
      runScan()
    }
  }, [autoScan, result, loading, error, runScan])

  if (!result && !loading && !error) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-1">Run a comprehensive security scan of your installation</p>
          <p className="text-xs text-muted-foreground/60">Checks credentials, network config, OpenClaw hardening, and runtime security</p>
        </div>
        <Button onClick={() => runScan()} variant="outline" size="sm" className="border-void-cyan/30 text-void-cyan hover:bg-void-cyan/10">
          Run Security Scan
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="py-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.5 3.5l2 2M10.5 10.5l2 2M3.5 12.5l2-2M10.5 5.5l2-2" />
              </svg>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Scanning security...</p>
            <p className="text-xs text-muted-foreground/60">Checking credentials, network, runtime, and OS</p>
          </div>
        </div>

        <div className="space-y-2">
          {Object.entries(CATEGORY_LABELS).map(([key, meta], i) => (
            <div
              key={key}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/20 border border-border/10"
              style={{ animation: `fadeIn 0.3s ease-out ${i * 0.15}s both` }}
            >
              <span className="w-5 h-5 rounded bg-surface-2 flex items-center justify-center text-xs font-mono text-muted-foreground/50">
                {meta.icon}
              </span>
              <span className="flex-1 text-xs text-muted-foreground/50">{meta.label}</span>
              <div className="w-12 h-1 rounded-full bg-border/20 overflow-hidden">
                <div
                  className="h-full bg-emerald-500/40 rounded-full animate-[indeterminate_1.5s_infinite_ease-in-out]"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <p role="alert" className="text-sm text-red-400">{error}</p>
        <Button onClick={() => runScan()} variant="outline" size="sm">Retry</Button>
      </div>
    )
  }

  if (!result) return null

  const failingChecks = Object.values(result.categories).flatMap((cat) => cat.checks.filter((check) => check.status !== 'pass'))
  const autoFixableChecks = failingChecks.filter((check) => FIXABLE_IDS.has(check.id))
  const manualChecks = failingChecks.filter((check) => !FIXABLE_IDS.has(check.id))

  return (
    <div className="space-y-4">
      {/* Score header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`text-3xl font-bold tabular-nums ${OVERALL_COLOR[result.overall]}`}>
            {result.score}
          </div>
          <div>
            <div className={`text-sm font-medium capitalize ${OVERALL_COLOR[result.overall]}`}>
              {result.overall.replace('-', ' ')}
            </div>
            <div className="text-xs text-muted-foreground">Security score</div>
          </div>
        </div>
        <Button onClick={() => runScan()} variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
          Re-scan
        </Button>
      </div>

      {/* Score bar */}
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            result.score >= 90 ? 'bg-green-400' :
            result.score >= 70 ? 'bg-green-300' :
            result.score >= 40 ? 'bg-amber-400' : 'bg-red-400'
          }`}
          style={{ width: `${result.score}%` }}
        />
      </div>

      {/* Issue summary + Fix All */}
      {(() => {
        const totalFailing = failingChecks.length
        return totalFailing > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              <p>{totalFailing} issue{totalFailing > 1 ? 's' : ''} found</p>
              <p>{autoFixableChecks.length} auto-fixable, {manualChecks.length} manual/review</p>
            </div>
            <Button
              onClick={() => runFix()}
              disabled={fixing !== null || autoFixableChecks.length === 0}
              variant="outline"
              size="sm"
              className="text-xs border-void-cyan/30 text-void-cyan hover:bg-void-cyan/10"
            >
              {fixing === 'all' ? 'Fixing...' : 'Fix Auto-Fixable'}
            </Button>
          </div>
        ) : null
      })()}

      {/* Fix result feedback */}
      {fixResult && (
        <div role="status" className={`text-xs px-3 py-2 rounded-lg border ${fixResult.failed > 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-green-500/10 border-green-500/20 text-green-300'}`}>
          {fixResult.attempted > 0 && <span>{fixResult.attempted} auto-fix attempt{fixResult.attempted > 1 ? 's' : ''}. </span>}
          {fixResult.fixed > 0 && <span>{fixResult.fixed} issue{fixResult.fixed > 1 ? 's' : ''} fixed. </span>}
          {fixResult.failed > 0 && <span>{fixResult.failed} failed. </span>}
          {fixResult.remaining > 0 && <span>{fixResult.remaining} issue{fixResult.remaining > 1 ? 's' : ''} remain. </span>}
          {fixResult.remainingManual > 0 && <span>{fixResult.remainingManual} still need manual action or review. </span>}
          {fixResult.note && <span className="text-muted-foreground">{fixResult.note}</span>}
        </div>
      )}

      {/* Categories */}
      <div className="space-y-2">
        {Object.entries(result.categories).map(([key, cat]) => {
          const meta = CATEGORY_LABELS[key]
          const isExpanded = expandedCategory === key
          const failing = cat.checks.filter(c => c.status !== 'pass')

          return (
            <div key={key} className="border border-border/50 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-1/50 transition-colors"
              >
                <span className="w-5 h-5 rounded bg-surface-2 flex items-center justify-center text-xs font-mono text-muted-foreground">
                  {meta?.icon || key[0].toUpperCase()}
                </span>
                <span className="flex-1 text-sm font-medium">{meta?.label || key}</span>
                <span className={`text-xs tabular-nums ${cat.score >= 80 ? 'text-green-400' : cat.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {cat.score}%
                </span>
                {failing.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {failing.length} issue{failing.length > 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-xs text-muted-foreground/50">{isExpanded ? '-' : '+'}</span>
              </button>

              {isExpanded && (
                <div className="border-t border-border/30 px-3 py-2 space-y-1.5 bg-surface-1/30">
                  {cat.checks.map(check => (
                    <div key={check.id} className="flex items-start gap-2 py-1">
                      <span className={`font-mono text-xs mt-0.5 w-4 shrink-0 ${STATUS_COLOR[check.status]}`}>
                        [{STATUS_ICON[check.status]}]
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{check.name}</span>
                          {check.severity && (
                            <span className={`text-2xs px-1 py-0.5 rounded font-mono leading-none ${SEVERITY_BADGE[check.severity].className}`}>
                              {SEVERITY_BADGE[check.severity].label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{check.detail}</p>
                        {check.fix && check.status !== 'pass' && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-void-cyan/70 flex-1 min-w-0">Fix: {check.fix}</p>
                            {FIXABLE_IDS.has(check.id) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); runFix([check.id]) }}
                                disabled={fixing !== null}
                                className="shrink-0 px-1.5 py-0.5 text-2xs rounded border border-void-cyan/30 text-void-cyan hover:bg-void-cyan/10 transition-colors disabled:opacity-50"
                                title={FIX_SAFETY[check.id] === 'requires-review' ? 'Requires review — may affect running services' : FIX_SAFETY[check.id] === 'requires-restart' ? 'Requires restart to take effect' : 'Auto-fix this issue'}
                              >
                                {fixing === check.id ? 'Fixing...' : FIX_SAFETY[check.id] === 'requires-review' ? 'Fix *' : 'Fix'}
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); copyFix(check.fix, check.id) }}
                              className="shrink-0 px-1.5 py-0.5 text-2xs rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                              title="Copy fix command"
                            >
                              {copiedFix === check.id ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
