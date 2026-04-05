'use client'

import React, { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { matchesGlobPattern } from '@/lib/exec-approval-utils'

interface PatternEntry {
  pattern: string
}

interface RecentCommand {
  command: string
  agentName: string
}

interface AgentAllowlistCardProps {
  agentId: string
  patterns: PatternEntry[]
  recentCommands: RecentCommand[]
  onAddPattern: () => void
  onUpdatePattern: (index: number, value: string) => void
  onRemovePattern: (index: number) => void
  onRemoveAgent: () => void
}

export function AgentAllowlistCard({
  agentId,
  patterns,
  recentCommands,
  onAddPattern,
  onUpdatePattern,
  onRemovePattern,
  onRemoveAgent,
}: AgentAllowlistCardProps): React.JSX.Element {
  const t = useTranslations('execApproval')
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const previewMatches = useMemo((): RecentCommand[] => {
    if (previewIndex === null) return []
    const pat = patterns[previewIndex]?.pattern
    if (!pat) return []
    return recentCommands.filter(c => matchesGlobPattern(pat, c.command))
  }, [previewIndex, patterns, recentCommands])

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">{agentId}</span>
          <span className="text-xs text-muted-foreground">
            {patterns.length} pattern{patterns.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onAddPattern}>
            {t('addPattern')}
          </Button>
          <button
            onClick={onRemoveAgent}
            className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-1"
            title="Remove agent"
          >
            x
          </button>
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          {t('noAllowlistPatterns')}
        </div>
      ) : (
        <div className="space-y-2">
          {patterns.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={entry.pattern}
                onChange={(e) => onUpdatePattern(index, e.target.value)}
                onFocus={() => setPreviewIndex(index)}
                onBlur={() => setPreviewIndex(null)}
                placeholder="e.g. git *, npm install *, ls"
                className="flex-1 font-mono bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button
                onClick={() => onRemovePattern(index)}
                className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-1.5"
                title="Remove pattern"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {previewIndex !== null && patterns[previewIndex]?.pattern && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="text-xs text-muted-foreground mb-1">
            {t('previewMatches', { count: previewMatches.length })}
          </div>
          {previewMatches.length > 0 && (
            <div className="space-y-1 max-h-24 overflow-auto">
              {previewMatches.slice(0, 5).map((m, i) => (
                <div key={i} className="text-xs font-mono text-green-400 truncate">
                  $ {m.command}
                </div>
              ))}
              {previewMatches.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  {t('andMore', { count: previewMatches.length - 5 })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
