'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { NewJobForm, FormErrors } from './cron-management-types'

const PREDEFINED_SCHEDULES = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 6 AM', value: '0 6 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Monthly (1st)', value: '0 0 1 * *' },
]

interface CronAddJobModalProps {
  newJob: NewJobForm
  formErrors: FormErrors
  availableModels: string[]
  onClose: () => void
  onAddJob: () => void
  onFormChange: (updated: NewJobForm) => void
}

export function CronAddJobModal({
  newJob,
  formErrors,
  availableModels,
  onClose,
  onAddJob,
  onFormChange,
}: CronAddJobModalProps): React.JSX.Element {
  const t = useTranslations('cronManagement')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl m-4">
        <h2 className="text-xl font-semibold mb-4">{t('addNewCronJob')}</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('fieldJobName')}
            </label>
            <input
              type="text"
              value={newJob.name}
              onChange={(e) => onFormChange({ ...newJob, name: e.target.value })}
              placeholder="e.g., daily-backup, system-check"
              className={`w-full px-3 py-2 border rounded-md bg-background text-foreground ${
                formErrors.name ? 'border-red-500' : 'border-border'
              }`}
            />
            {formErrors.name && (
              <div className="mt-1 text-xs text-red-400">{formErrors.name}</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('fieldSchedule')}
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newJob.schedule}
                onChange={(e) => onFormChange({ ...newJob, schedule: e.target.value })}
                placeholder="0 * * * *"
                className={`flex-1 px-3 py-2 border rounded-md bg-background text-foreground font-mono ${
                  formErrors.schedule ? 'border-red-500' : 'border-border'
                }`}
              />
              <select
                value=""
                onChange={(e) =>
                  e.target.value && onFormChange({ ...newJob, schedule: e.target.value })
                }
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
              >
                <option value="">{t('quickSelect')}</option>
                {PREDEFINED_SCHEDULES.map((sched) => (
                  <option key={sched.value} value={sched.value}>
                    {sched.label}
                  </option>
                ))}
              </select>
            </div>
            {formErrors.schedule ? (
              <div className="mt-1 text-xs text-red-400">{formErrors.schedule}</div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">{t('scheduleFormatHint')}</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('fieldCommand')}
            </label>
            <textarea
              value={newJob.command}
              onChange={(e) => onFormChange({ ...newJob, command: e.target.value })}
              placeholder="cd /path/to/script && ./script.sh"
              className={`w-full px-3 py-2 border rounded-md bg-background text-foreground font-mono h-24 ${
                formErrors.command ? 'border-red-500' : 'border-border'
              }`}
            />
            {formErrors.command && (
              <div className="mt-1 text-xs text-red-400">{formErrors.command}</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('fieldModelOptional')}
            </label>
            <input
              type="text"
              value={newJob.model}
              onChange={(e) => onFormChange({ ...newJob, model: e.target.value })}
              list="cron-model-suggestions"
              placeholder="anthropic/claude-sonnet-4-20250514"
              className={`w-full px-3 py-2 border rounded-md bg-background text-foreground font-mono text-sm ${
                formErrors.model ? 'border-red-500' : 'border-border'
              }`}
            />
            <datalist id="cron-model-suggestions">
              {availableModels.map((modelName) => (
                <option key={modelName} value={modelName} />
              ))}
            </datalist>
            {formErrors.model ? (
              <div className="mt-1 text-xs text-red-400">{formErrors.model}</div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">{t('modelHint')}</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('fieldStaggerOptional')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newJob.staggerSeconds}
                onChange={(e) => onFormChange({ ...newJob, staggerSeconds: e.target.value })}
                placeholder="0"
                className={`w-32 px-3 py-2 border rounded-md bg-background text-foreground font-mono text-sm ${
                  formErrors.staggerSeconds ? 'border-red-500' : 'border-border'
                }`}
              />
              <span className="text-sm text-muted-foreground">{t('seconds')}</span>
            </div>
            {formErrors.staggerSeconds ? (
              <div className="mt-1 text-xs text-red-400">{formErrors.staggerSeconds}</div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">{t('staggerHint')}</div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('fieldDescriptionOptional')}
            </label>
            <input
              type="text"
              value={newJob.description}
              onChange={(e) => onFormChange({ ...newJob, description: e.target.value })}
              placeholder={t('descriptionPlaceholder')}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button onClick={onClose} variant="ghost">
            {t('cancel')}
          </Button>
          <Button onClick={onAddJob}>{t('addJob')}</Button>
        </div>
      </div>
    </div>
  )
}
