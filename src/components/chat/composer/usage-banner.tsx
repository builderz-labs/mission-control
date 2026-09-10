'use client'

import { useTranslations } from 'next-intl'

export function UsageBanner({
  resetsAt,
}: {
  usedPercent?: number | null
  resetsAt: string | null
}) {
  const t = useTranslations('chatDesktop')
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
      <span className="h-2 w-2 rounded-full bg-red-400" />
      <span>{t('sessionLimitReached')}</span>
      {resetsAt ? <span className="text-red-300/80">Resets at {resetsAt}</span> : null}
    </div>
  )
}
