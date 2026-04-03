'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { SkillSummary, SkillContentResponse } from './types'

interface SkillDrawerProps {
  skill: SkillSummary
  content: SkillContentResponse | null
  draftContent: string
  loading: boolean
  error: string | null
  saving: boolean
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onDraftChange: (value: string) => void
}

export function SkillDrawer({
  skill,
  content,
  draftContent,
  loading,
  error,
  saving,
  onClose,
  onSave,
  onDelete,
  onDraftChange,
}: SkillDrawerProps) {
  const t = useTranslations('skills')

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-[min(52rem,100vw)] bg-card border-l border-border shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{skill.name}</h3>
            <p className="text-2xs text-muted-foreground truncate">
              {skill.source} • {skill.path}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving || loading}>
              {t('delete')}
            </Button>
            <Button variant="outline" size="sm" onClick={onSave} disabled={saving || loading}>
              {t('save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>{t('close')}</Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">{t('loadingSkillContent')}</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : content ? (
            <>
              {content.security && content.security.issues.length > 0 && (
                <SecurityBanner security={content.security} t={t} />
              )}
              <textarea
                value={draftContent}
                onChange={(e) => onDraftChange(e.target.value)}
                className="w-full h-full min-h-[70vh] bg-card p-4 text-xs text-muted-foreground leading-5 font-mono whitespace-pre rounded-none border-0 focus:outline-none"
              />
            </>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">{t('noContent')}</div>
          )}
        </div>
      </aside>
    </div>
  )
}

interface SecurityBannerProps {
  security: NonNullable<SkillContentResponse['security']>
  t: ReturnType<typeof useTranslations>
}

function SecurityBanner({ security, t }: SecurityBannerProps) {
  const colorClass = security.status === 'rejected'
    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
    : security.status === 'warning'
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
      : 'bg-slate-500/10 border-slate-500/30 text-slate-300'

  return (
    <div className={`mx-4 mt-3 rounded-lg border p-3 text-xs ${colorClass}`}>
      <div className="font-medium mb-1">{t('security')}: {security.status}</div>
      {security.issues.map((issue, i) => (
        <div key={i} className="flex items-start gap-1.5 mt-1">
          <span className={`mt-0.5 text-2xs font-mono ${
            issue.severity === 'critical' ? 'text-rose-400'
              : issue.severity === 'warning' ? 'text-amber-400'
              : 'text-slate-400'
          }`}>[{issue.severity}]</span>
          <span>{issue.description}{issue.line ? ` (line ${issue.line})` : ''}</span>
        </div>
      ))}
    </div>
  )
}
