'use client'

import { useTranslations } from 'next-intl'
import { type LogEntry } from '@/store/slices/log-slice'
import { getLogLevelColor, getLogLevelBg } from './log-level-utils'

interface LogEntryRowProps {
  entry: LogEntry
}

export function LogEntryRow({ entry }: LogEntryRowProps): React.JSX.Element {
  const t = useTranslations('logViewer')

  return (
    <div className={`border-l-4 pl-4 py-2 rounded-r-md ${getLogLevelBg(entry.level)}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-muted-foreground">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className={`font-medium uppercase ${getLogLevelColor(entry.level)}`}>
              {entry.level}
            </span>
            <span className="text-muted-foreground">
              [{entry.source}]
            </span>
            {entry.session && (
              <span className="text-muted-foreground">
                session:{entry.session}
              </span>
            )}
          </div>
          <div className="mt-1 text-foreground break-words">
            {entry.message}
          </div>
          {entry.data && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {t('additionalData')}
              </summary>
              <pre className="mt-1 text-xs text-muted-foreground overflow-auto">
                {JSON.stringify(entry.data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
