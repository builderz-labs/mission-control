'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { getErrorMessage } from '@/lib/types/sql'
import type { Tenant, OsUser, Project } from '@/store'

interface OrgRowProps {
  label: string
  initial: string
  active: boolean
  colorClass: string
  onClick: () => void
  isActiveOrg: boolean
  projects: Project[]
  activeProject: Project | null
  onSwitchProject: (project: Project | null) => void
  onNewProject: () => void
}

/** Org row with collapsible nested projects (only shown for the active org) */
export function OrgRow({ label, initial, active, colorClass, onClick, isActiveOrg, projects, activeProject, onSwitchProject, onNewProject }: OrgRowProps) {
  return (
    <div>
      <Button
        variant="ghost"
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start ${
          active ? 'text-primary bg-primary/10 hover:bg-primary/15' : 'text-foreground'
        }`}
      >
        <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${colorClass}`}>{initial}</div>
        <span className="truncate">{label}</span>
        {isActiveOrg && (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0 ml-auto text-muted-foreground/40">
            <polyline points="4,6 8,10 12,6" />
          </svg>
        )}
      </Button>
      {isActiveOrg && (
        <div className="pl-4 mt-0.5 mb-1">
          <Button
            variant="ghost"
            onClick={() => onSwitchProject(null)}
            className={`w-full flex items-center gap-2 px-2 py-1 h-auto rounded-md text-[11px] justify-start ${
              !activeProject ? 'text-primary bg-primary/5 hover:bg-primary/10' : ''
            }`}
          >
            <div className="w-4 h-4 rounded bg-muted-foreground/10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5 text-muted-foreground">
                <circle cx="8" cy="8" r="2" />
              </svg>
            </div>
            All
          </Button>
          {projects.map((project) => (
            <Button
              key={project.id}
              variant="ghost"
              onClick={() => onSwitchProject(project)}
              className={`w-full flex items-center gap-2 px-2 py-1 h-auto rounded-md text-[11px] justify-start ${
                activeProject?.id === project.id ? 'text-primary bg-primary/5 hover:bg-primary/10' : 'text-foreground hover:bg-secondary/60'
              }`}
            >
              <div
                className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold shrink-0 ${
                  !project.color ? (project.status === 'active' ? 'bg-blue-500/20 text-blue-400' : 'bg-muted-foreground/10 text-muted-foreground') : ''
                }`}
                style={project.color ? { backgroundColor: `${project.color}33`, color: project.color } : undefined}
              >{project.ticket_prefix?.slice(0, 2) || project.name?.[0]?.toUpperCase() || 'P'}</div>
              <span className="truncate">{project.name}</span>
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {typeof project.task_count === 'number' && project.task_count > 0 && (
                  <span className="text-[9px] bg-white/10 px-1 rounded text-muted-foreground/50">{project.task_count}</span>
                )}
                {project.deadline && project.deadline < Math.floor(Date.now() / 1000) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Overdue" />
                )}
                <span className="text-muted-foreground/30 text-[10px]">{project.ticket_prefix}</span>
              </div>
            </Button>
          ))}
          <Button
            variant="ghost"
            onClick={onNewProject}
            className="w-full flex items-center gap-2 px-2 py-1 h-auto rounded-md text-[11px] justify-start"
          >
            <div className="w-4 h-4 flex items-center justify-center text-muted-foreground/50">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </div>
            New project...
          </Button>
        </div>
      )}
    </div>
  )
}

interface ContextSwitcherProps {
  currentUser: import('@/store').CurrentUser | null
  isAdmin: boolean
  isLocal: boolean
  isConnected: boolean
  tenants: Tenant[]
  osUsers: OsUser[]
  activeTenant: Tenant | null
  onSwitchTenant: (tenant: Tenant | null) => void
  projects: Project[]
  activeProject: Project | null
  onSwitchProject: (project: Project | null) => void
  expanded: boolean
  defaultOrgName: string
  navigateToPanel: (panel: string) => void
  fetchTenants: () => Promise<void>
  fetchOsUsers: () => Promise<void>
  interfaceMode: 'essential' | 'full'
  setInterfaceMode: (mode: 'essential' | 'full') => void
  activeTab: string
}

/** Bottom-of-sidebar user/org/project context switcher with a popover menu */
export function ContextSwitcher({ currentUser, isAdmin, isLocal, isConnected, tenants, osUsers, activeTenant, onSwitchTenant, projects, activeProject, onSwitchProject, expanded, defaultOrgName, navigateToPanel, fetchTenants, fetchOsUsers, interfaceMode, setInterfaceMode, activeTab }: ContextSwitcherProps) {
  const { setShowProjectManagerModal } = useMissionControl()
  const linkedUsernames = new Set(tenants.map(t => t.linux_user))
  const unlinkedOsUsers = osUsers.filter(u => !linkedUsernames.has(u.username) && !u.is_process_owner)
  const [open, setOpen] = useState(false)

  // Close on Escape key for keyboard accessibility
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])
  const [createMode, setCreateMode] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', display_name: '', gateway_port: '', install_openclaw: true, install_claude: false, install_codex: false })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const userName = currentUser?.display_name || currentUser?.username || 'User'
  const initials = userName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const tenantName = activeTenant?.display_name || defaultOrgName
  const projectName = activeProject?.name
  const contextLine = projectName ? `${tenantName} / ${projectName}` : tenantName
  const connectionLabel = isLocal ? 'Local Mode' : isConnected ? 'Connected' : 'Disconnected'
  const connectionDotClass = isLocal ? 'bg-void-cyan' : isConnected ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className={`shrink-0 relative ${expanded ? 'px-3 pb-3' : 'flex flex-col items-center pb-3'}`}>
      {/* Trigger */}
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        title={expanded ? undefined : `${userName} · ${contextLine} · ${connectionLabel}`}
        className={`flex items-center rounded-lg ${
          expanded
            ? 'w-full gap-2.5 px-2.5 py-2 h-auto hover:bg-secondary/80 border border-transparent hover:border-border justify-start'
            : 'w-10 h-10 hover:bg-secondary group'
        }`}
      >
        <div className={`shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold relative ${
          expanded ? 'w-8 h-8' : 'w-8 h-8'
        } ${currentUser?.avatar_url ? '' : 'bg-primary/20 text-primary'}`}>
          {currentUser?.avatar_url ? (
            <Image
              src={currentUser.avatar_url}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            initials
          )}
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${connectionDotClass}`} />
        </div>

        {expanded && (
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium text-foreground truncate leading-tight">{userName}</div>
            <div className="text-[11px] text-muted-foreground truncate leading-tight">{contextLine}</div>
          </div>
        )}

        {expanded && (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50">
            <polyline points="4,10 8,6 12,10" />
          </svg>
        )}

        {!expanded && (
          <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-popover text-popover-foreground border border-border rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
            {userName}
          </span>
        )}
      </Button>

      {/* Popover (opens upward) */}
      {open && (
        <>
          {/* Backdrop — not focusable; Escape key closes via useEffect */}
          <div role="presentation" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 bg-popover border border-border rounded-lg shadow-xl min-w-[220px] max-h-[400px] overflow-y-auto ${
            expanded ? 'bottom-full mb-1 left-3 right-3' : 'bottom-full mb-1 left-1'
          }`}>
            {/* User info header */}
            <div className="px-3 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                  currentUser?.avatar_url ? '' : 'bg-primary/20 text-primary'
                }`}>
                  {currentUser?.avatar_url ? (
                    <Image
                      src={currentUser.avatar_url}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{userName}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{currentUser?.role || 'user'}</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${connectionDotClass}`} />
                      {connectionLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interface mode toggle */}
            <div className="mx-2 border-t border-border my-1" />
            <div className="px-3 py-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Interface</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  onClick={async () => {
                    if (interfaceMode === 'essential') return
                    setInterfaceMode('essential')
                    const essentialIds = new Set(['overview', 'agents', 'tasks', 'chat', 'activity', 'logs', 'settings'])
                    if (!essentialIds.has(activeTab)) navigateToPanel('overview')
                    try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'essential' } }), signal: AbortSignal.timeout(8000) }) } catch {}
                  }}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                    interfaceMode === 'essential'
                      ? 'bg-void-amber/15 text-void-amber'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${interfaceMode === 'essential' ? 'bg-void-amber' : 'bg-muted-foreground/30'}`} />
                  Essential
                </button>
                <button
                  onClick={async () => {
                    if (interfaceMode === 'full') return
                    setInterfaceMode('full')
                    try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { 'general.interface_mode': 'full' } }), signal: AbortSignal.timeout(8000) }) } catch {}
                  }}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors border-l border-border ${
                    interfaceMode === 'full'
                      ? 'bg-void-cyan/15 text-void-cyan'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${interfaceMode === 'full' ? 'bg-void-cyan' : 'bg-muted-foreground/30'}`} />
                  Full
                </button>
              </div>
            </div>

            {/* Quick navigation */}
            <div className="mx-2 border-t border-border my-1" />
            <div className="px-1 py-0.5">
              <Button
                variant="ghost"
                onClick={() => { navigateToPanel('settings'); setOpen(false) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60">
                  <circle cx="8" cy="8" r="3" />
                  <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" />
                </svg>
                Settings
              </Button>
              <Button
                variant="ghost"
                onClick={() => { navigateToPanel('activity'); setOpen(false) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60">
                  <path d="M14 8H11L9.5 13L6.5 3L5 8H2" />
                </svg>
                Activity
              </Button>
            </div>

            {/* Organizations with nested projects (admin only) */}
            {isAdmin && (
              <>
                <div className="mx-2 border-t border-border my-1" />
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[10px] tracking-wider text-muted-foreground/60 font-semibold">ORGANIZATIONS</span>
                </div>
                <div className="px-1">
                  <OrgRow
                    label={defaultOrgName}
                    initial={defaultOrgName[0]?.toUpperCase() || 'D'}
                    active={!activeTenant}
                    colorClass="bg-void-cyan/20 text-void-cyan"
                    onClick={() => { onSwitchTenant(null); setOpen(false) }}
                    isActiveOrg={!activeTenant}
                    projects={projects}
                    activeProject={activeProject}
                    onSwitchProject={(p) => { onSwitchProject(p); setOpen(false) }}
                    onNewProject={() => { setShowProjectManagerModal(true); setOpen(false) }}
                  />
                  {tenants.map((tenant) => (
                    <OrgRow
                      key={tenant.id}
                      label={tenant.display_name}
                      initial={tenant.display_name?.[0]?.toUpperCase() || 'T'}
                      active={activeTenant?.id === tenant.id}
                      colorClass={tenant.status === 'active' ? 'bg-green-500/20 text-green-400' : tenant.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}
                      onClick={() => { onSwitchTenant(tenant); setOpen(false) }}
                      isActiveOrg={activeTenant?.id === tenant.id}
                      projects={projects}
                      activeProject={activeProject}
                      onSwitchProject={(p) => { onSwitchProject(p); setOpen(false) }}
                      onNewProject={() => { setShowProjectManagerModal(true); setOpen(false) }}
                    />
                  ))}
                  {/* Unprovisioned OS users discovered but not yet linked to a tenant */}
                  {unlinkedOsUsers.map((osUser) => {
                    const hasTools = osUser.has_claude || osUser.has_codex
                    const disabled = isLocal && !hasTools
                    const tools = [
                      osUser.has_claude && 'claude',
                      osUser.has_codex && 'codex',
                      osUser.has_openclaw && 'openclaw',
                    ].filter(Boolean)
                    const statusLabel = isLocal
                      ? (tools.length > 0 ? tools.join('+') : 'no tools')
                      : 'unlinked'
                    return (
                      <Button
                        key={osUser.username}
                        variant="ghost"
                        onClick={() => { if (!disabled) { navigateToPanel('super-admin'); setOpen(false) } }}
                        disabled={disabled}
                        title={disabled
                          ? `${osUser.username} — no claude or codex installed at ${osUser.home_dir}`
                          : `${osUser.home_dir} (uid ${osUser.uid}) — click to provision as organization`
                        }
                        className={`w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start ${
                          disabled
                            ? 'text-muted-foreground/30 cursor-not-allowed'
                            : ''
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          disabled ? 'bg-muted-foreground/5 text-muted-foreground/30' : 'bg-muted-foreground/10 text-muted-foreground/60'
                        }`}>
                          {osUser.username[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="truncate">{osUser.username}</span>
                        <span className={`ml-auto text-[10px] shrink-0 ${disabled ? 'text-muted-foreground/20' : 'text-muted-foreground/30'}`}>{statusLabel}</span>
                      </Button>
                    )
                  })}
                </div>
                <div className="px-1 pb-1">
                  {!createMode ? (
                    <Button
                      variant="ghost"
                      disabled
                      title="Temporarily disabled — not functional yet"
                      className="w-full flex items-center gap-2 px-2 py-1.5 h-auto rounded-md text-xs justify-start text-muted-foreground/40 cursor-not-allowed"
                    >
                      <div className="w-5 h-5 flex items-center justify-center text-muted-foreground/40">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                          <path d="M8 3v10M3 8h10" />
                        </svg>
                      </div>
                      New organization...
                    </Button>
                  ) : (
                    <div className="px-1 pt-1 pb-1 space-y-1.5">
                      <input
                        value={createForm.username}
                        onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))}
                        placeholder="Username (OS user)"
                        autoFocus
                        className="w-full h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                      />
                      <input
                        value={createForm.display_name}
                        onChange={(e) => setCreateForm(f => ({ ...f, display_name: e.target.value }))}
                        placeholder="Display name"
                        className="w-full h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                      />
                      {!isLocal && (
                        <input
                          value={createForm.gateway_port}
                          onChange={(e) => setCreateForm(f => ({ ...f, gateway_port: e.target.value }))}
                          placeholder="Gateway port (required)"
                          className="w-full h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                        />
                      )}
                      {isLocal && (
                        <div className="space-y-1 px-0.5">
                          <div className="text-[10px] text-muted-foreground/60 font-semibold tracking-wider">INSTALL TOOLS</div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={createForm.install_openclaw}
                                onChange={(e) => setCreateForm(f => ({ ...f, install_openclaw: e.target.checked }))}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-[10px] text-foreground">openclaw</span>
                            </label>
                            <label className={`flex items-center gap-1 ${createForm.install_openclaw ? 'opacity-50' : ''} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={createForm.install_claude || createForm.install_openclaw}
                                onChange={(e) => setCreateForm(f => ({ ...f, install_claude: e.target.checked }))}
                                disabled={createForm.install_openclaw}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-[10px] text-foreground">claude</span>
                              {createForm.install_openclaw && <span className="text-[9px] text-muted-foreground/50 italic">included</span>}
                            </label>
                            <label className={`flex items-center gap-1 ${createForm.install_openclaw ? 'opacity-50' : ''} cursor-pointer`}>
                              <input
                                type="checkbox"
                                checked={createForm.install_codex || createForm.install_openclaw}
                                onChange={(e) => setCreateForm(f => ({ ...f, install_codex: e.target.checked }))}
                                disabled={createForm.install_openclaw}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-[10px] text-foreground">codex</span>
                              {createForm.install_openclaw && <span className="text-[9px] text-muted-foreground/50 italic">included</span>}
                            </label>
                          </div>
                        </div>
                      )}
                      {createError && (
                        <div className="text-[10px] text-red-400 px-0.5">{createError}</div>
                      )}
                      <div className="flex gap-1.5">
                        <Button
                          size="xs"
                          disabled={creating}
                          onClick={async () => {
                            const username = createForm.username.trim().toLowerCase()
                            const display_name = createForm.display_name.trim()
                            if (!username || !display_name) { setCreateError('Username and display name required'); return }
                            if (!/^[a-z][a-z0-9_-]{1,30}[a-z0-9]$/.test(username)) { setCreateError('Invalid username format'); return }
                            if (!isLocal && !createForm.gateway_port) { setCreateError('Gateway port required'); return }
                            setCreating(true)
                            setCreateError(null)
                            try {
                              const res = await fetch('/api/super/os-users', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  username,
                                  display_name,
                                  gateway_mode: !isLocal,
                                  gateway_port: createForm.gateway_port ? Number(createForm.gateway_port) : undefined,
                                  install_openclaw: createForm.install_openclaw,
                                  install_claude: createForm.install_claude,
                                  install_codex: createForm.install_codex,
                                }),
                                signal: AbortSignal.timeout(8000),
                              })
                              const json = await res.json().catch(() => ({}))
                              if (!res.ok) throw new Error(json?.error || 'Failed to create organization')
                              setCreateForm({ username: '', display_name: '', gateway_port: '', install_openclaw: true, install_claude: false, install_codex: false })
                              setCreateMode(false)
                              await Promise.all([fetchTenants(), fetchOsUsers()])
                            } catch (e: unknown) {
                              setCreateError(getErrorMessage(e) || 'Failed to create')
                            } finally {
                              setCreating(false)
                            }
                          }}
                          className="flex-1 text-[11px]"
                        >
                          {creating ? 'Creating...' : isLocal ? 'Create User' : 'Create + Queue'}
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => { setCreateMode(false); setCreateError(null) }}
                          className="text-[11px]"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
