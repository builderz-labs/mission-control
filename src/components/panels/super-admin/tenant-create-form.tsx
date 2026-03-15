import type { CreateFormState, GatewayOption } from './types'

interface TenantCreateFormProps {
  form: CreateFormState
  setForm: (fn: (f: CreateFormState) => CreateFormState) => void
  gatewayOptions: GatewayOption[]
  gatewayLoadError: string | null
  createTenant: () => void
  setCreateExpanded: (v: boolean) => void
}

export function TenantCreateForm({
  form,
  setForm,
  gatewayOptions,
  gatewayLoadError,
  createTenant,
  setCreateExpanded,
}: TenantCreateFormProps) {
  return (
    <div className="rounded-lg border border-primary/30 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Create New Workspace</h3>
        <button
          onClick={() => setCreateExpanded(false)}
          className="text-muted-foreground hover:text-foreground text-lg leading-none transition-smooth"
          aria-label="Close create form"
        >
          ×
        </button>
      </div>
      <div className="p-4 space-y-3">
        <div className="text-xs text-muted-foreground">
          Fill in the workspace details below and click <span className="text-foreground font-medium">Create + Queue</span> to provision a new client instance.
        </div>
        {gatewayLoadError && (
          <div className="px-3 py-2 rounded-md text-xs border bg-amber-500/10 text-amber-300 border-amber-500/20">
            Gateway list unavailable: {gatewayLoadError}. Using fallback owner value.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="Slug (e.g. acme)"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="Display name"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={form.linux_user}
            onChange={(e) => setForm((f) => ({ ...f, linux_user: e.target.value }))}
            placeholder="Linux user (optional)"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <select
            value={form.owner_gateway}
            onChange={(e) => setForm((f) => ({ ...f, owner_gateway: e.target.value }))}
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
            onChange={(e) => setForm((f) => ({ ...f, plan_tier: e.target.value }))}
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          >
            <option value="standard">Standard</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <input
            value={form.gateway_port}
            onChange={(e) => setForm((f) => ({ ...f, gateway_port: e.target.value }))}
            placeholder="Gateway port"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <input
            value={form.dashboard_port}
            onChange={(e) => setForm((f) => ({ ...f, dashboard_port: e.target.value }))}
            placeholder="Dashboard port"
            className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
          />
          <label className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.dry_run}
              onChange={(e) => setForm((f) => ({ ...f, dry_run: e.target.checked }))}
            />
            Dry-run
          </label>
          <button
            onClick={createTenant}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth"
          >
            Create + Queue
          </button>
        </div>
      </div>
    </div>
  )
}
