'use client'

import { useRouter } from 'next/navigation'

interface PulseData {
  pending_approvals: number
  overdue_projects: number
}

export function DailyPulse({ pulse }: { pulse: PulseData }) {
  const router = useRouter()

  const cards = [
    {
      value: pulse.pending_approvals,
      label: 'Approval Menunggu',
      sub: 'klik → queue',
      color: pulse.pending_approvals > 0 ? 'text-amber-400' : 'text-green-400',
      onClick: () => router.push('/brands'),
    },
    {
      value: pulse.overdue_projects,
      label: 'Project Overdue',
      sub: 'klik → brands',
      color: pulse.overdue_projects > 0 ? 'text-red-400' : 'text-green-400',
      onClick: () => router.push('/brands'),
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <button
          key={card.label}
          onClick={card.onClick}
          className="bg-neutral-900 border border-neutral-700 rounded-lg p-4 text-left hover:border-neutral-500 transition-colors"
        >
          <div className={`text-3xl font-bold ${card.color}`}>{card.value}</div>
          <div className="text-sm text-neutral-300 mt-1">{card.label}</div>
          <div className="text-xs text-neutral-500 mt-0.5">{card.sub}</div>
        </button>
      ))}
      {/* Placeholder slots to keep 4-column grid */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 opacity-40">
        <div className="text-3xl font-bold text-neutral-400">—</div>
        <div className="text-sm text-neutral-500 mt-1">Outstanding</div>
        <div className="text-xs text-neutral-600 mt-0.5">klik → /finance</div>
      </div>
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 opacity-40">
        <div className="text-3xl font-bold text-neutral-400">—</div>
        <div className="text-sm text-neutral-500 mt-1">Konten Review</div>
        <div className="text-xs text-neutral-600 mt-0.5">klik → /content</div>
      </div>
    </div>
  )
}
