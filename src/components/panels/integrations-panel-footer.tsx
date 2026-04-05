'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface UnsavedChangesBarProps {
  editCount: number
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}

export function UnsavedChangesBar({
  editCount,
  saving,
  onSave,
  onDiscard,
}: UnsavedChangesBarProps) {
  const t = useTranslations('integrations')

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
      <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      <span className="text-xs text-foreground">
        {editCount} unsaved change{editCount === 1 ? '' : 's'}
      </span>
      <Button onClick={onDiscard} variant="ghost" size="xs">
        {t('discard')}
      </Button>
      <Button onClick={onSave} disabled={saving} size="xs">
        {saving ? t('saving') : t('save')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface ConfirmRemoveDialogProps {
  integrationId: string
  keys: string[]
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmRemoveDialog({
  keys,
  onConfirm,
  onCancel,
}: ConfirmRemoveDialogProps) {
  const t = useTranslations('integrations')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl p-5 max-w-sm mx-4 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{t('removeTitle')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('removeDescription', {
            target: keys.length === 1 ? keys[0] : String(keys.length),
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} variant="outline" size="sm">
            {t('cancel')}
          </Button>
          <Button onClick={onConfirm} variant="destructive" size="sm">
            {t('remove')}
          </Button>
        </div>
      </div>
    </div>
  )
}
