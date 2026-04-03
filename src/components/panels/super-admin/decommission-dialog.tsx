'use client'

import { Button } from '@/components/ui/button'
import type { DecommissionDialogState } from './super-admin-types'

interface DecommissionDialogProps {
  dialog: DecommissionDialogState
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
  onUpdate: (updates: Partial<DecommissionDialogState>) => void
}

export function DecommissionDialog({
  dialog,
  canSubmit,
  onClose,
  onSubmit,
  onUpdate,
}: DecommissionDialogProps) {
  if (!dialog.open || !dialog.tenant) return null

  const tenant = dialog.tenant

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Queue Decommission: {tenant.display_name}</h3>
          <p className="text-xs text-muted-foreground mt-1">Review impact before creating the job.</p>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
              <input
                type="radio"
                checked={dialog.dryRun}
                onChange={() => onUpdate({ dryRun: true, confirmText: '' })}
              />
              <span>
                <span className="block font-medium">Dry-run (recommended)</span>
                <span className="text-muted-foreground">No system changes, validates commands and logs a full plan execution.</span>
              </span>
            </label>
            <label className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
              <input
                type="radio"
                checked={!dialog.dryRun}
                onChange={() => onUpdate({ dryRun: false })}
              />
              <span>
                <span className="block font-medium">Live execution</span>
                <span className="text-red-200/80">Will stop services and apply teardown changes after approval + run.</span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
              <input
                type="checkbox"
                checked={dialog.removeLinuxUser}
                onChange={(e) => onUpdate({
                  removeLinuxUser: e.target.checked,
                  removeStateDirs: e.target.checked ? false : dialog.removeStateDirs,
                })}
              />
              <span>
                <span className="block font-medium">Remove Linux user</span>
                <span className="text-muted-foreground">Runs `userdel -r` and removes home directory.</span>
              </span>
            </label>
            <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
              <input
                type="checkbox"
                checked={dialog.removeStateDirs}
                disabled={dialog.removeLinuxUser}
                onChange={(e) => onUpdate({ removeStateDirs: e.target.checked })}
              />
              <span>
                <span className="block font-medium">Remove state/workspace dirs</span>
                <span className="text-muted-foreground">Deletes `.openclaw` and `workspace` paths when user is kept.</span>
              </span>
            </label>
          </div>

          <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground">
            <div className="font-medium mb-1">Impact summary</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>• Stops and disables `openclaw-gateway@{tenant.linux_user}.service`.</li>
              <li>• Removes `/etc/openclaw-tenants/{tenant.linux_user}.env`.</li>
              <li>• {dialog.removeLinuxUser
                ? 'Linux user will be removed.'
                : (dialog.removeStateDirs ? 'State/workspace directories will be removed.' : 'Linux user and directories are retained.')}
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <textarea
              value={dialog.reason}
              onChange={(e) => onUpdate({ reason: e.target.value })}
              placeholder="Reason (optional)"
              className="w-full min-h-[72px] rounded-md bg-secondary border border-border px-3 py-2 text-sm text-foreground"
            />
            {!dialog.dryRun && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Type <span className="font-mono text-foreground">{tenant.slug}</span> to confirm live decommission
                </label>
                <input
                  value={dialog.confirmText}
                  onChange={(e) => onUpdate({ confirmText: e.target.value })}
                  className="w-full h-9 rounded-md bg-secondary border border-border px-3 text-sm text-foreground font-mono"
                />
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={dialog.submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onSubmit}
            disabled={!canSubmit || dialog.submitting}
            className="bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
          >
            {dialog.submitting
              ? 'Queueing...'
              : (dialog.dryRun ? 'Queue Dry-run Decommission' : 'Queue Live Decommission')}
          </Button>
        </div>
      </div>
    </div>
  )
}
