'use client'

import type { StateCreator } from 'zustand'

export interface CurrentUser {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  workspace_id?: number
  tenant_id?: number
  provider?: 'local' | 'google'
  email?: string | null
  avatar_url?: string | null
}

export interface Tenant {
  id: number
  slug: string
  display_name: string
  status: string
  linux_user: string
  gateway_port?: number | null
  owner_gateway?: string
}

export interface OsUser {
  username: string
  uid: number
  home_dir: string
  shell: string
  linked_tenant_id: number | null
  has_claude: boolean
  has_codex: boolean
  has_openclaw: boolean
  is_process_owner: boolean
}

export interface Project {
  id: number
  name: string
  slug: string
  description?: string
  ticket_prefix: string
  status: string
  github_repo?: string
  deadline?: number
  color?: string
  task_count?: number
  assigned_agents?: string[]
  github_sync_enabled?: boolean
  github_labels_initialized?: boolean
  github_default_branch?: string
}

export interface TenantSlice {
  // Current authenticated user
  currentUser: CurrentUser | null
  setCurrentUser: (user: CurrentUser | null) => void

  // Multi-tenant context
  activeTenant: Tenant | null
  tenants: Tenant[]
  osUsers: OsUser[]
  setActiveTenant: (tenant: Tenant | null) => void
  setTenants: (tenants: Tenant[]) => void
  fetchTenants: () => Promise<void>
  fetchOsUsers: () => Promise<void>

  // Project context (scoped to current tenant/workspace)
  activeProject: Project | null
  projects: Project[]
  setActiveProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void
  fetchProjects: () => Promise<void>
}

// Reads a JSON value from localStorage safely, returning null on failure or SSR
function readLocalStorageJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch { return null }
}

// Tenant, auth, and project slice — user identity, multi-tenancy, and project scoping
export const createTenantSlice: StateCreator<TenantSlice, [], [], TenantSlice> = (set) => ({
  currentUser: null,
  tenants: [],
  osUsers: [],
  projects: [],

  // Rehydrate persisted selections from localStorage on first render
  activeTenant: readLocalStorageJson<Tenant>('mc-active-tenant'),
  activeProject: readLocalStorageJson<Project>('mc-active-project'),

  setCurrentUser: (user) => set({ currentUser: user }),

  setActiveTenant: (tenant) => {
    try {
      if (tenant) {
        localStorage.setItem('mc-active-tenant', JSON.stringify(tenant))
      } else {
        localStorage.removeItem('mc-active-tenant')
      }
    } catch {}
    set({ activeTenant: tenant })
  },

  setTenants: (tenants) => set({ tenants }),

  fetchTenants: async () => {
    try {
      const res = await fetch('/api/super/tenants', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const data = await res.json() as { tenants?: Tenant[] }
      set({ tenants: Array.isArray(data?.tenants) ? data.tenants : [] })
    } catch {}
  },

  fetchOsUsers: async () => {
    try {
      const res = await fetch('/api/super/os-users', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const data = await res.json() as { users?: OsUser[] }
      set({ osUsers: Array.isArray(data?.users) ? data.users : [] })
    } catch {}
  },

  setActiveProject: (project) => {
    try {
      if (project) {
        localStorage.setItem('mc-active-project', JSON.stringify(project))
      } else {
        localStorage.removeItem('mc-active-project')
      }
    } catch {}
    set({ activeProject: project })
  },

  setProjects: (projects) => set({ projects }),

  fetchProjects: async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const data = await res.json() as { projects?: Project[] }
      set({ projects: Array.isArray(data?.projects) ? data.projects : [] })
    } catch {}
  },
})
