'use client'

import { Button } from '@/components/ui/button'
import type { GatewayOption } from './super-admin-types'

interface CreateWorkspaceFormProps {
  form: {
    slug: string
    display_name: string
    linux_user: string
    plan_tier: string
    owner_gateway: string
    gateway_port: string
    dashboard_port: string
    dry_run: boolean
  }
  gatewayOptions: GatewayOption[]
  gatewayLoadError: string | null
  onFormChange: (field: string, value: string | boolean) => void
  onCreate: () => void
  onClose: () => void
}

export function CreateWorkspaceForm({
  form,
  gatewayOptions,
  gatewayLoadError,
  onFormChange,
  onCreate,
  onClose,
}: CreateWorkspaceFormProps) {
  return (
    <div className="rounded-lg border border-primary/30 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Create New Workspace</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close create form"
          className="text-lg w-6 h-6"
        >
          ×
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <div className="text-xs text-muted-foreground">
          Fill in the workspace details below and click{' '}
          <span className="text-foreground font-medium">Create + Queue</span> to provision a new client instance.
        </div>
        {gatewayLoadError && (
          <div className="px-3 py-2 rounded-md text-xs border bg-amber-500/10 text-amber-300 border-amber-500/20">
            Gateway list unavailable: {gatewayLoadError}. Using fallback owner value.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={form.slug}
            onChange={(e) => onFormChange('slug', e.target.value)}
            placeholder="Slug (e.g. acme)"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={form.display_name}
            onChange={(e) => onFormChange('display_name', e.target.value)}
            placeholder="Display name"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={form.linux_user}
            onChange={(e) => onFormChange('linux_user', e.target.value)}
            placeholder="Linux user (optional)"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <select
            value={form.owner_gateway}
            onChange={(e) => onFormChange('owner_gateway', e.target.value)}
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          >
            {gatewayOptions.length === 0 ? (
              <option value={form.owner_gateway || 'openclaw-main'}>{form.owner_gateway || 'openclaw-main'}</option>
            ) : (
              gatewayOptions.map((gw) => (
                <option key={gw.id} value={gw.name}>
                  {gw.name}{gw.is_primary ? ' (primary)' : ''}
                </option>
              ))
            )}
          </select>
          <select
            value={form.plan_tier}
            onChange={(e) => onFormChange('plan_tier', e.target.value)}
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          >
            <option value="standard">Standard</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <input
            value={form.gateway_port}
            onChange={(e) => onFormChange('gateway_port', e.target.value)}
            placeholder="Gateway port"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={form.dashboard_port}
            onChange={(e) => onFormChange('dashboard_port', e.target.value)}
            placeholder="Dashboard port"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <label className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.dry_run}
              onChange={(e) => onFormChange('dry_run', e.target.checked)}
            />
            Dry-run
          </label>
          <Button onClick={onCreate}>
            Create + Queue
          </Button>
        </div>
      </div>
    </div>
  )
}
