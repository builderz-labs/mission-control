'use client'

import Link from 'next/link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrandCardData = Record<string, any>

const GATE_LABELS: Record<number, string> = {
  1: 'Strategi Bulanan',
  2: 'CEP Selection',
  3: 'Content Brief',
  4: 'Content Execution',
}

function healthColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#eab308'
  return '#ef4444'
}

function healthEmoji(score: number): string {
  if (score >= 80) return '✅'
  if (score >= 60) return '⚠'
  return '🔴'
}

export function BrandCard({ brand }: { brand: BrandCardData }) {
  const color = healthColor(brand.health_score)
  const pct = brand.health_score

  return (
    <div className="border border-neutral-700 rounded-lg bg-neutral-900 p-3 flex flex-col gap-2 hover:border-neutral-500 transition-colors">
      {/* Name + client */}
      <div className="flex items-start justify-between gap-1">
        <div>
          <div className="font-semibold text-sm text-neutral-100 leading-tight">{brand.name}</div>
          <div className="text-xs text-neutral-500 mt-0.5">{brand.client_name}</div>
        </div>
        {brand.category && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 flex-shrink-0">{brand.category}</span>
        )}
      </div>

      {/* Health bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-neutral-400">Health</span>
          <span className="text-xs font-medium" style={{ color }}>{pct}% {healthEmoji(pct)}</span>
        </div>
        <div className="h-1.5 bg-neutral-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-0.5 text-xs">
        <div className="text-neutral-400">
          <span className="text-green-400">●</span> {brand.active_project_count} project aktif
        </div>
        {brand.pending_approval_count > 0 ? (
          <div className="text-amber-400">⏳ {brand.pending_approval_count} approval pending</div>
        ) : (
          <div className="text-neutral-500">✅ All clear</div>
        )}
        {brand.current_gate && (
          <div className="text-neutral-400">
            📋 Tahap: {GATE_LABELS[brand.current_gate] ?? `Gate ${brand.current_gate}`}
          </div>
        )}
        {brand.has_overdue && (
          <div className="text-red-400">🔴 Ada item overdue</div>
        )}
      </div>

      {/* CTA */}
      <Link
        href={`/brands/${brand.id}`}
        className="mt-auto block text-center text-xs py-1.5 px-3 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 hover:text-white transition-colors"
      >
        → Masuk Session
      </Link>
    </div>
  )
}
