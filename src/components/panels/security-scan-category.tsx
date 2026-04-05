'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  SCAN_STATUS_ICON,
  SCAN_STATUS_COLOR,
  SEVERITY_BADGE,
  type ScanCategory,
} from './security-audit-panel-types'

// Sort order for severity levels — lower index = shown first
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

interface Props {
  label: string
  icon: string
  category: ScanCategory
  failingCount: number
}

export function ScanCategoryRow({ label, icon, category, failingCount }: Props) {
  const t = useTranslations('securityAudit')
  const [expanded, setExpanded] = useState(false)

  const scoreColor =
    category.score >= 80
      ? 'text-green-400'
      : category.score >= 50
      ? 'text-amber-400'
      : 'text-red-400'

  const sortedChecks = [...category.checks].sort((a, b) => {
    // Passing checks sink to the bottom
    if (a.status === 'pass' && b.status !== 'pass') return 1
    if (a.status !== 'pass' && b.status === 'pass') return -1
    return (
      (SEVERITY_ORDER[a.severity ?? 'medium'] ?? 2) -
      (SEVERITY_ORDER[b.severity ?? 'medium'] ?? 2)
    )
  })

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/50 transition-colors"
      >
        <span className="w-5 h-5 rounded bg-secondary flex items-center justify-center text-xs font-mono text-muted-foreground">
          {icon}
        </span>
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span className={`text-xs tabular-nums ${scoreColor}`}>{category.score}%</span>
        {failingCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('issueCount', { count: failingCount })}
          </span>
        )}
        <span className="text-xs text-muted-foreground/50">{expanded ? '-' : '+'}</span>
      </button>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1.5 bg-secondary/20">
          {sortedChecks.map((check) => (
            <div key={check.id} className="flex items-start gap-2 py-1">
              <span
                className={`font-mono text-xs mt-0.5 w-4 shrink-0 ${SCAN_STATUS_COLOR[check.status]}`}
              >
                [{SCAN_STATUS_ICON[check.status]}]
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{check.name}</span>
                  {check.severity && (
                    <span
                      className={`text-2xs px-1 py-0.5 rounded font-mono leading-none ${SEVERITY_BADGE[check.severity].className}`}
                    >
                      {SEVERITY_BADGE[check.severity].label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{check.detail}</p>
                {check.fix && check.status !== 'pass' && (
                  <p className="text-xs text-primary/70 mt-0.5">
                    {t('fixPrefix', { fix: check.fix })}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
