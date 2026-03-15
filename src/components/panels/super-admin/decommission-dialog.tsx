import type { DecommissionDialogState } from './types'

interface DecommissionDialogProps {
  decommissionDialog: DecommissionDialogState
  setDecommissionDialog: (fn: (prev: DecommissionDialogState) => DecommissionDialogState) => void
  closeDecommissionDialog: () => void
  queueDecommissionFromDialog: () => void
  canSubmitDecommission: boolean
}

export function DecommissionDialog({
  decommissionDialog,
  setDecommissionDialog,
  closeDecommissionDialog,
  queueDecommissionFromDialog,
  canSubmitDecommission,
}: DecommissionDialogProps) {
  if (!decommissionDialog.open || !decommissionDialog.tenant) return null

  const tenant = decommissionDialog.tenant

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
                checked={decommissionDialog.dryRun}
                onChange={() => setDecommissionDialog((prev) => ({ ...prev, dryRun: true, confirmText: '' }))}
              />
              <span>
                <span className="block font-medium">Dry-run (recommended)</span>
                <span className="text-muted-foreground">No system changes, validates commands and logs a full plan execution.</span>
              </span>
            </label>
            <label className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
              <input
                type="radio"
                checked={!decommissionDialog.dryRun}
                onChange={() => setDecommissionDialog((prev) => ({ ...prev, dryRun: false }))}
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
                checked={decommissionDialog.removeLinuxUser}
                onChange={(e) => setDecommissionDialog((prev) => ({
                  ...prev,
                  removeLinuxUser: e.target.checked,
                  removeStateDirs: e.target.checked ? false : prev.removeStateDirs,
                }))}
              />
              <span>
                <span className="block font-medium">Remove Linux user</span>
                <span className="text-muted-foreground">Runs `userdel -r` and removes home directory.</span>
              </span>
            </label>
            <label className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-foreground flex items-start gap-2">
              <input
                type="checkbox"
                checked={decommissionDialog.removeStateDirs}
                disabled={decommissionDialog.removeLinuxUser}
                onChange={(e) => setDecommissionDialog((prev) => ({ ...prev, removeStateDirs: e.target.checked }))}
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
              <li>• {decommissionDialog.removeLinuxUser ? 'Linux user will be removed.' : (decommissionDialog.removeStateDirs ? 'State/workspace directories will be removed.' : 'Linux user and directories are retained.')}</li>
            </ul>
          </div>

          <div className="space-y-2">
            <textarea
              value={decommissionDialog.reason}
              onChange={(e) => setDecommissionDialog((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Reason (optional)"
              className="w-full min-h-[72px] rounded-md bg-secondary border border-border px-3 py-2 text-sm text-foreground"
            />

            {!decommissionDialog.dryRun && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Type <span className="font-mono text-foreground">{tenant.slug}</span> to confirm live decommission
                </label>
                <input
                  value={decommissionDialog.confirmText}
                  onChange={(e) => setDecommissionDialog((prev) => ({ ...prev, confirmText: e.target.value }))}
                  className="w-full h-9 rounded-md bg-secondary border border-border px-3 text-sm text-foreground font-mono"
                />
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={closeDecommissionDialog}
            disabled={decommissionDialog.submitting}
            className="h-8 px-3 rounded-md border border-border text-sm text-foreground hover:bg-secondary/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={queueDecommissionFromDialog}
            disabled={!canSubmitDecommission || decommissionDialog.submitting}
            className="h-8 px-3 rounded-md border border-red-500/40 bg-red-500/20 text-red-300 text-sm disabled:opacity-50 hover:bg-red-500/30"
          >
            {decommissionDialog.submitting
              ? 'Queueing...'
              : (decommissionDialog.dryRun ? 'Queue Dry-run Decommission' : 'Queue Live Decommission')}
          </button>
        </div>
      </div>
    </div>
  )
}
