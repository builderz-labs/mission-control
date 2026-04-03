'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { InstallStep } from './InstallStep'
import type { InstallModalState } from './types'

interface InstallModalProps {
  modal: InstallModalState
  onClose: () => void
  onViewInstalled: () => void
}

export function InstallModal({ modal, onClose, onViewInstalled }: InstallModalProps) {
  const t = useTranslations('skills')

  const fetchStatus = modal.step === 'fetching' ? 'active'
    : (modal.step === 'error' && !modal.securityStatus) ? 'error'
    : 'done'

  const scanStatus = modal.step === 'fetching' ? 'pending'
    : modal.step === 'scanning' ? 'active'
    : (modal.step === 'error' && modal.securityStatus === 'rejected') ? 'error'
    : (modal.step === 'error' && !modal.securityStatus) ? 'error'
    : 'done'

  const writeStatus = ['fetching', 'scanning'].includes(modal.step) ? 'pending'
    : modal.step === 'writing' ? 'active'
    : modal.step === 'error' ? 'error'
    : 'done'

  const isFinished = modal.step === 'done' || modal.step === 'error'

  return (
    <div className="fixed inset-0 z-[130]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-4">
            <h3 className="text-sm font-semibold text-foreground">
              {modal.step === 'done' ? t('skillInstalled') : modal.step === 'error' ? t('installFailed') : t('installingSkill')}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 truncate">{modal.name}</p>
          </div>

          <div className="px-5 pb-5 space-y-3">
            <div className="space-y-2">
              <InstallStep label={t('stepFetching')} status={fetchStatus} />
              <InstallStep label={t('stepScanning')} status={scanStatus} />
              <InstallStep label={t('stepWriting')} status={writeStatus} />
            </div>

            {modal.message && isFinished && (
              <div className={`rounded-md border px-3 py-2 text-xs ${
                modal.step === 'error'
                  ? 'bg-destructive/10 border-destructive/30 text-destructive'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}>
                {modal.message}
              </div>
            )}

            {modal.securityStatus && modal.step === 'done' && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{t('security')}</span>
                <span className={
                  modal.securityStatus === 'clean' ? 'text-emerald-400'
                    : modal.securityStatus === 'warning' ? 'text-amber-400'
                    : 'text-rose-400'
                }>{modal.securityStatus}</span>
              </div>
            )}
          </div>

          {isFinished && (
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              {modal.step === 'done' && (
                <Button variant="outline" size="sm" onClick={onViewInstalled}>
                  {t('viewInstalled')}
                </Button>
              )}
              <Button variant="default" size="sm" onClick={onClose}>
                {modal.step === 'done' ? t('done') : t('close')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
