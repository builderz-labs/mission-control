'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface Check {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
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

export function SecurityScanCard({ compact = false }: { compact?: boolean }) {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/security-scan')
      if (!res.ok) {
        setError(res.status === 401 ? 'Admin access required' : 'Scan failed')
        return
      }
      setResult(await res.json())
    } catch {
      setError('Failed to connect')
    } finally {
      setLoading(false)
    }
  }, [])

  if (!result && !loading && !error) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-1">Run a comprehensive security scan of your installation</p>
          <p className="text-xs text-muted-foreground/60">Checks credentials, network config, OpenClaw hardening, and runtime security</p>
        </div>
        <Button onClick={runScan} variant="outline" size="sm" className="border-void-cyan/30 text-void-cyan hover:bg-void-cyan/10">
          Run Security Scan
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <div className="w-1.5 h-1.5 rounded-full bg-void-cyan animate-pulse" />
        <div className="w-1.5 h-1.5 rounded-full bg-void-cyan animate-pulse" style={{ animationDelay: '200ms' }} />
        <div className="w-1.5 h-1.5 rounded-full bg-void-cyan animate-pulse" style={{ animationDelay: '400ms' }} />
        <span className="text-sm text-muted-foreground ml-2">Scanning...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <p className="text-sm text-red-400">{error}</p>
        <Button onClick={runScan} variant="outline" size="sm">Retry</Button>
      </div>
    )
  }

  if (!result) return null

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
        <Button onClick={runScan} variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
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
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm">{check.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{check.detail}</p>
                        {check.fix && check.status !== 'pass' && (
                          <p className="text-xs text-void-cyan/70 mt-0.5">Fix: {check.fix}</p>
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
