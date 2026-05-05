'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface BotScores {
  demand: number
  buyer_pain: number
  competition_weakness: number
  differentiation: number
  ease_of_production: number
  visual_sales_potential: number
  evergreen_value: number
  price_potential: number
  maintenance_burden: number
}

interface BotBrief {
  product_idea: string
  buyer: string
  pain_point: string
  evidence_summary: string
  recommendation: string
  next_action: string
  scores: BotScores
}

interface BotResult {
  status: 'DRAFT_CREATED' | 'WATCH' | 'REJECTED'
  risk_level: number
  label: string
  brief: BotBrief
  evidence_entry_id: string | null
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT_CREATED: 'text-emerald-500',
  WATCH:         'text-yellow-500',
  REJECTED:      'text-red-500',
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums">{pct}</span>
    </div>
  )
}

export function PassiveIncomeBotPanel() {
  const [niche, setNiche]       = useState('')
  const [dryRun, setDryRun]     = useState(true)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<BotResult | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [lastRun, setLastRun]   = useState<string | null>(null)

  async function runBot() {
    if (!niche.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/bots/passive-income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: niche.trim(), _dry_run: dryRun }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error || `Error ${res.status}`)
      } else {
        setResult(body as BotResult)
        setLastRun(new Date().toLocaleTimeString())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Passive Income Bot</h2>
          <p className="text-xs text-muted-foreground">Scores a niche and generates a draft opportunity brief.</p>
        </div>
        {lastRun && (
          <span className="text-xs text-muted-foreground">Last run: {lastRun}</span>
        )}
      </div>

      {/* Input row */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Enter a niche (e.g. minimalist desk mats)"
          value={niche}
          onChange={e => setNiche(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && runBot()}
          className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          maxLength={500}
          disabled={loading}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={e => setDryRun(e.target.checked)}
            className="h-3.5 w-3.5"
            disabled={loading}
          />
          Dry run
        </label>
        <Button
          size="sm"
          onClick={runBot}
          disabled={loading || !niche.trim()}
          className="h-8"
        >
          {loading ? 'Running…' : 'Run'}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-md border border-border bg-card space-y-3 p-3">
          {/* Status + label */}
          <div className="flex items-center justify-between">
            <span className={`font-semibold text-sm ${STATUS_COLOR[result.status] ?? ''}`}>
              {result.status.replace('_', ' ')}
            </span>
            <span className="text-[10px] font-mono border border-yellow-500/40 text-yellow-600 rounded px-1.5 py-0.5">
              {result.label}
            </span>
          </div>

          {/* Brief */}
          <div className="space-y-1 text-sm">
            <p><span className="font-medium">Idea:</span> {result.brief.product_idea}</p>
            <p><span className="font-medium">Buyer:</span> {result.brief.buyer}</p>
            <p className="text-muted-foreground text-xs">{result.brief.pain_point}</p>
          </div>

          {/* Scores */}
          <div className="space-y-1 pt-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Scores</p>
            <ScoreBar label="Demand"               value={result.brief.scores.demand} />
            <ScoreBar label="Buyer pain"           value={result.brief.scores.buyer_pain} />
            <ScoreBar label="Competition gap"      value={result.brief.scores.competition_weakness} />
            <ScoreBar label="Differentiation"      value={result.brief.scores.differentiation} />
            <ScoreBar label="Ease of production"   value={result.brief.scores.ease_of_production} />
            <ScoreBar label="Visual sales appeal"  value={result.brief.scores.visual_sales_potential} />
            <ScoreBar label="Evergreen value"      value={result.brief.scores.evergreen_value} />
            <ScoreBar label="Price potential"      value={result.brief.scores.price_potential} />
          </div>

          {/* Recommendation */}
          <div className="border-t border-border pt-2 space-y-1 text-xs">
            <p><span className="font-medium">Recommendation:</span> {result.brief.recommendation}</p>
            <p className="text-muted-foreground"><span className="font-medium">Next:</span> {result.brief.next_action}</p>
          </div>

          {result.evidence_entry_id && (
            <p className="text-[10px] text-muted-foreground">Evidence ID: {result.evidence_entry_id}</p>
          )}
        </div>
      )}
    </div>
  )
}
