import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavRail } from '@/components/layout/nav-rail'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'

vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <img {...props} /> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/store', () => ({ useMissionControl: vi.fn() }))
vi.mock('@/lib/navigation', () => ({
  useNavigateToPanel: vi.fn(),
  usePrefetchPanel: () => vi.fn(),
}))
vi.mock('@/lib/plugins', () => ({ getPluginNavItems: () => [] }))

const mockedUseMissionControl = vi.mocked(useMissionControl)
const mockedNavigateToPanel = vi.mocked(useNavigateToPanel)

function setMissionControlRole(role: 'admin' | 'viewer') {
  mockedUseMissionControl.mockReturnValue({
    activeTab: 'overview',
    connection: 'connected',
    dashboardMode: 'gateway',
    currentUser: { role },
    activeTenant: null,
    tenants: [],
    osUsers: [],
    setActiveTenant: vi.fn(),
    fetchTenants: vi.fn(),
    fetchOsUsers: vi.fn(),
    activeProject: null,
    projects: [],
    setActiveProject: vi.fn(),
    fetchProjects: vi.fn(),
    sidebarExpanded: true,
    collapsedGroups: [],
    toggleSidebar: vi.fn(),
    toggleGroup: vi.fn(),
    defaultOrgName: 'Workspace',
    interfaceMode: 'essential',
    setInterfaceMode: vi.fn(),
  } as ReturnType<typeof useMissionControl>)
}

afterEach(() => vi.clearAllMocks())

describe('project login vault navigation', () => {
  it('shows Login Vault to admins in essential mode and navigates to its panel', () => {
    setMissionControlRole('admin')
    const navigate = vi.fn()
    mockedNavigateToPanel.mockReturnValue(navigate)

    render(<NavRail />)

    const loginVaultButton = screen.getByRole('button', { name: 'Login Vault' })
    fireEvent.click(loginVaultButton)
    expect(navigate).toHaveBeenCalledWith('login-vault')
  })

  it('hides Login Vault from viewers', () => {
    setMissionControlRole('viewer')
    mockedNavigateToPanel.mockReturnValue(vi.fn())

    render(<NavRail />)

    expect(screen.queryByRole('button', { name: 'Login Vault' })).not.toBeInTheDocument()
  })

  it('routes the login-vault panel to ProjectLoginVaultPanel', () => {
    const pageSource = readFileSync('src/app/[[...panel]]/page.tsx', 'utf8')
    expect(pageSource).toMatch(/case 'login-vault':\s*return <ProjectLoginVaultPanel \/>/)
    expect(pageSource).toMatch(/import \{ ProjectLoginVaultPanel \} from '@\/components\/panels\/project-login-vault-panel'/)
  })
})
