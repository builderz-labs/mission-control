'use client'

import { useTranslations } from 'next-intl'

interface LogHeaderProps {
  logFilePath: string | null
  totalCount: number
  filteredCount: number
  isBufferFull: boolean
  maxBuffer: number
  isAutoScroll: boolean
  lastTimestamp: number | undefined
}

export function LogHeader({
  logFilePath, totalCount, filteredCount,
  isBufferFull, maxBuffer, isAutoScroll, lastTimestamp,
}: LogHeaderProps): React.JSX.Element {
  const t = useTranslations('logViewer')

  return (
    <>
      <div className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('description')}
          {logFilePath && (
            <span className="ml-3 font-mono text-xs text-muted-foreground/70">{logFilePath}</span>
          )}
        </p>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{t('showing', { filtered: filteredCount, total: totalCount })}</span>
          {isBufferFull && (
            <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
              {t('bufferFull', { max: maxBuffer })}
            </span>
          )}
        </div>
        <div>
          {t('autoScroll')}: {isAutoScroll ? t('on') : t('off')} •
          {t('lastUpdated')}: {lastTimestamp ? new Date(lastTimestamp).toLocaleTimeString() : t('never')}
        </div>
      </div>
    </>
  )
}
