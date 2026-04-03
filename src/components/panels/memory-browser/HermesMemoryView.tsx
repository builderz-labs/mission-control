'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import type { HermesMemoryData } from './types'

const AGENT_CAP = 2200
const USER_CAP = 1375

interface HermesMemoryViewProps {
  data: HermesMemoryData | null
  isLoading: boolean
  onRefresh: () => void
}

export function HermesMemoryView({ data, isLoading, onRefresh }: HermesMemoryViewProps) {
  const t = useTranslations('memoryBrowser')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader variant="inline" label={t('loadingHermes')} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
        <span className="text-sm font-mono mb-3">{t('noHermesData')}</span>
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('refresh')}</Button>
      </div>
    )
  }

  const agentPct = Math.min(100, Math.round((data.agentMemorySize / AGENT_CAP) * 100))
  const userPct = Math.min(100, Math.round((data.userMemorySize / USER_CAP) * 100))

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono text-foreground mb-1">{t('hermesMemoryTitle')}</h2>
          <p className="text-xs text-muted-foreground font-mono">{t('hermesMemoryDesc')}</p>
        </div>
        <Button onClick={onRefresh} size="sm" variant="secondary">{t('refresh')}</Button>
      </div>

      {/* MEMORY.md */}
      <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold font-mono text-foreground">MEMORY.md</span>
            <span className="text-[10px] font-mono text-purple-400">{data.agentMemoryEntries} entries</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {data.agentMemorySize}/{AGENT_CAP} chars ({agentPct}%)
          </span>
        </div>
        <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all ${agentPct > 90 ? 'bg-red-500' : agentPct > 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
            style={{ width: `${agentPct}%`, opacity: 0.7 }}
          />
        </div>
        {data.agentMemory ? (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed max-h-80 overflow-y-auto bg-[hsl(var(--surface-0))] rounded-md p-3 border border-border/30">{data.agentMemory}</pre>
        ) : (
          <div className="text-xs font-mono text-muted-foreground/40 py-4 text-center">{t('noAgentMemory')}</div>
        )}
      </div>

      {/* USER.md */}
      <div className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold font-mono text-foreground">USER.md</span>
            <span className="text-[10px] font-mono text-purple-400">{data.userMemoryEntries} entries</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {data.userMemorySize}/{USER_CAP} chars ({userPct}%)
          </span>
        </div>
        <div className="h-1.5 bg-[hsl(var(--surface-0))] rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all ${userPct > 90 ? 'bg-red-500' : userPct > 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
            style={{ width: `${userPct}%`, opacity: 0.7 }}
          />
        </div>
        {data.userMemory ? (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed max-h-80 overflow-y-auto bg-[hsl(var(--surface-0))] rounded-md p-3 border border-border/30">{data.userMemory}</pre>
        ) : (
          <div className="text-xs font-mono text-muted-foreground/40 py-4 text-center">{t('noUserMemory')}</div>
        )}
      </div>
    </div>
  )
}
