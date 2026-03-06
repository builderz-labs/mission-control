'use client'

import { useState, useEffect, useCallback } from 'react'

interface AuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  message: string
  file?: string
  line?: number
  detail?: string
}

interface AuditResult {
  ok: boolean
  message: string
  findings: AuditFinding[]
  timestamp: number
  durationMs: number
}

const severityColors: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-400',
  medium: 'text-amber-400',
  low: 'text-blue-400',
}

const severityBg: Record<string, string> = {
  critical: 'bg-red-500/15 border-red-500/30',
  high: 'bg-orange-400/15 border-orange-400/30',
  medium: 'bg-amber-400/15 border-amber-400/30',
  low: 'bg-blue-400/15 border-blue-400/30',
}

const categoryLabels: Record<string, string> = {
  'code-execution': 'Code Execution',
  'obfuscation': 'Obfuscation',
  'network': 'Network Access',
  'credentials': 'Credential Access',
  'prototype-pollution': 'Prototype Pollution',
  'crypto-theft': 'Crypto Wallet Theft',
  'file-exfiltration': 'File Exfiltration',
  'keylogging': 'Keylogging',
  'clipboard-theft': 'Clipboard Theft',
  'reconnaissance': 'Reconnaissance',
  'cryptomining': 'Cryptomining',
  'exfiltration': 'Data Exfiltration',
  'install-scripts': 'Install Scripts',
  'suspicious-deps': 'Suspicious Dependencies',
  'prompt-injection': 'Prompt Injection',
  'mcp-server': 'MCP Server',
  'git-hooks': 'Git Hooks',
  'agent-config': 'Agent Config',
  'skill-prompt-injection': 'Skill Prompt Injection',
  'skill-crypto-access': 'Skill Crypto Access',
  'skill-file-access': 'Skill File Access',
  'skill-network-access': 'Skill Network Access',
  'skill-shell-access': 'Skill Shell Access',
  'skill-credential-access': 'Skill Credential Access',
  'skill-exfiltration': 'Skill Data Exfiltration',
  'skill-privilege-escalation': 'Skill Privilege Escalation',
  'environment': 'Environment',
}

export function SecurityAuditPanel() {
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/security-audit')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setResult(await res.json())
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  async function runFreshScan() {
    setScanning(true)
    try {
      const res = await fetch('/api/security-audit', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setResult(await res.json())
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  const filteredFindings = result?.findings.filter(f => {
    if (filterSeverity !== 'all' && f.severity !== filterSeverity) return false
    if (filterCategory !== 'all' && f.category !== filterCategory) return false
    return true
  }) ?? []

  const categories = [...new Set(result?.findings.map(f => f.category) ?? [])]
  const severityCounts = {
    critical: result?.findings.filter(f => f.severity === 'critical').length ?? 0,
    high: result?.findings.filter(f => f.severity === 'high').length ?? 0,
    medium: result?.findings.filter(f => f.severity === 'medium').length ?? 0,
    low: result?.findings.filter(f => f.severity === 'low').length ?? 0,
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading security audit...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Security Audit</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Scans git history, dependencies, agent configs, and MCP servers for threats
            </p>
          </div>
          <button
            onClick={runFreshScan}
            disabled={scanning}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-smooth"
          >
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className="px-6 py-4 shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {/* Status */}
              <div className={`rounded-lg border px-4 py-3 ${result.ok ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                <div className={`text-2xl font-bold ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {result.ok ? 'PASS' : 'FAIL'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Status</div>
              </div>

              {/* Severity counts */}
              <SummaryCard label="Critical" count={severityCounts.critical} color="text-red-500" active={filterSeverity === 'critical'} onClick={() => setFilterSeverity(filterSeverity === 'critical' ? 'all' : 'critical')} />
              <SummaryCard label="High" count={severityCounts.high} color="text-orange-400" active={filterSeverity === 'high'} onClick={() => setFilterSeverity(filterSeverity === 'high' ? 'all' : 'high')} />
              <SummaryCard label="Medium" count={severityCounts.medium} color="text-amber-400" active={filterSeverity === 'medium'} onClick={() => setFilterSeverity(filterSeverity === 'medium' ? 'all' : 'medium')} />
              <SummaryCard label="Low" count={severityCounts.low} color="text-blue-400" active={filterSeverity === 'low'} onClick={() => setFilterSeverity(filterSeverity === 'low' ? 'all' : 'low')} />
            </div>

            {/* Meta info + category filter */}
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs text-muted-foreground">
                Scanned in {result.durationMs}ms &middot; {new Date(result.timestamp).toLocaleString()}
              </div>

              {categories.length > 0 && (
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground"
                >
                  <option value="all">All categories</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{categoryLabels[c] || c}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Findings list */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {filteredFindings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center mb-3">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-green-400">
                    <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4L8 1z" />
                    <path d="M6 8l2 2 3-3" />
                  </svg>
                </div>
                <div className="text-foreground font-medium">
                  {result.findings.length === 0 ? 'No security issues found' : 'No findings match your filters'}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {result.findings.length === 0
                    ? 'The codebase, dependencies, and agent configs look clean.'
                    : 'Try adjusting the severity or category filter.'}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredFindings.map((finding, i) => (
                  <FindingCard key={i} finding={finding} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, count, color, active, onClick }: {
  label: string; count: number; color: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-4 py-3 text-left transition-smooth ${
        active ? 'bg-secondary border-primary/50 ring-1 ring-primary/30' : 'bg-card border-border hover:bg-secondary'
      }`}
    >
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </button>
  )
}

function FindingCard({ finding }: { finding: AuditFinding }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className={`w-full text-left rounded-lg border px-4 py-3 transition-smooth ${severityBg[finding.severity]}`}
    >
      <div className="flex items-start gap-3">
        {/* Severity badge */}
        <span className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 shrink-0 ${severityColors[finding.severity]}`}>
          {finding.severity}
        </span>

        <div className="flex-1 min-w-0">
          {/* Message */}
          <div className="text-sm text-foreground">{finding.message}</div>

          {/* Category + file */}
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
              {categoryLabels[finding.category] || finding.category}
            </span>
            {finding.file && (
              <span className="text-xs text-muted-foreground font-mono">
                {finding.file}{finding.line ? `:${finding.line}` : ''}
              </span>
            )}
          </div>

          {/* Detail (expandable) */}
          {expanded && finding.detail && (
            <div className="mt-2 text-xs text-muted-foreground font-mono bg-background/50 rounded px-3 py-2 break-all">
              {finding.detail}
            </div>
          )}
        </div>

        {/* Expand indicator */}
        {finding.detail && (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="4,6 8,10 12,6" />
          </svg>
        )}
      </div>
    </button>
  )
}
