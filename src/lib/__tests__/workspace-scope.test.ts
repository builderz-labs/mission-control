import { describe, it, expect } from 'vitest'
import {
  resolveWorkspaceId,
  requireWorkspaceId,
  isInWorkspace,
  enforceWorkspaceBoundary,
  requireAgentSelfAccess,
  requireAgentTaskAccess,
} from '@/lib/enforcement/workspace-scope'
import type { User } from '@/lib/auth'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: 'test',
    display_name: 'Test',
    role: 'operator',
    workspace_id: 10,
    tenant_id: 1,
    created_at: 0,
    updated_at: 0,
    last_login_at: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveWorkspaceId
// ---------------------------------------------------------------------------

describe('resolveWorkspaceId', () => {
  it('returns workspace_id when valid', () => {
    expect(resolveWorkspaceId(makeUser({ workspace_id: 5 }))).toBe(5)
  })

  it('returns null for workspace_id = 0', () => {
    expect(resolveWorkspaceId(makeUser({ workspace_id: 0 }))).toBeNull()
  })

  it('returns null for negative workspace_id', () => {
    expect(resolveWorkspaceId(makeUser({ workspace_id: -1 }))).toBeNull()
  })

  it('returns null for NaN workspace_id', () => {
    expect(resolveWorkspaceId(makeUser({ workspace_id: NaN }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// requireWorkspaceId
// ---------------------------------------------------------------------------

describe('requireWorkspaceId', () => {
  it('returns workspaceId for a valid user', () => {
    const result = requireWorkspaceId(makeUser({ workspace_id: 7 }))
    if (!('workspaceId' in result)) throw new Error('expected workspaceId')
    expect(result.workspaceId).toBe(7)
  })

  it('returns a 400 response when workspace_id is missing', () => {
    const result = requireWorkspaceId(makeUser({ workspace_id: 0 }))
    if ('workspaceId' in result) throw new Error('expected response')
    expect(result.response.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// isInWorkspace
// ---------------------------------------------------------------------------

describe('isInWorkspace', () => {
  it('returns true when user workspace matches resource workspace', () => {
    expect(isInWorkspace(makeUser({ workspace_id: 3 }), 3)).toBe(true)
  })

  it('returns false when workspaces differ', () => {
    expect(isInWorkspace(makeUser({ workspace_id: 3 }), 99)).toBe(false)
  })

  it('returns false when user workspace_id is invalid', () => {
    expect(isInWorkspace(makeUser({ workspace_id: 0 }), 1)).toBe(false)
  })

  it('user cannot read another workspace task (cross-workspace denied)', () => {
    const user = makeUser({ workspace_id: 1 })
    expect(isInWorkspace(user, 2)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// enforceWorkspaceBoundary
// ---------------------------------------------------------------------------

describe('enforceWorkspaceBoundary', () => {
  it('returns null (allow) when workspaces match', () => {
    const result = enforceWorkspaceBoundary(makeUser({ workspace_id: 4 }), 4)
    expect(result).toBeNull()
  })

  it('returns 403 response when workspaces differ', () => {
    const result = enforceWorkspaceBoundary(makeUser({ workspace_id: 4 }), 9)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('user cannot update another workspace task — boundary enforced', () => {
    const user = makeUser({ workspace_id: 1 })
    const deny = enforceWorkspaceBoundary(user, 2)
    expect(deny).not.toBeNull()
    expect(deny!.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// requireAgentSelfAccess
// ---------------------------------------------------------------------------

describe('requireAgentSelfAccess — human user (no agent_name)', () => {
  it('allows human user to access any agent', () => {
    const user = makeUser({ agent_name: null })
    expect(requireAgentSelfAccess(user, 'repo-steward')).toBeNull()
    expect(requireAgentSelfAccess(user, 'skill-intake')).toBeNull()
  })
})

describe('requireAgentSelfAccess — admin-scoped key', () => {
  it('allows admin-scoped agent key to access any agent', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'admin' })
    expect(requireAgentSelfAccess(user, 'skill-intake')).toBeNull()
    expect(requireAgentSelfAccess(user, 'other-agent')).toBeNull()
  })
})

describe('requireAgentSelfAccess — agent key (name-based path)', () => {
  it('allows agent key to access its own agent by name', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'operator' })
    expect(requireAgentSelfAccess(user, 'repo-steward')).toBeNull()
  })

  it('blocks agent key from accessing another agent by name', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'operator' })
    const result = requireAgentSelfAccess(user, 'skill-intake')
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('valid agent key accessing another agent fails — enforced', () => {
    const user = makeUser({ agent_name: 'agent-a', role: 'operator' })
    const deny = requireAgentSelfAccess(user, 'agent-b')
    expect(deny).not.toBeNull()
    expect(deny!.status).toBe(403)
  })
})

describe('requireAgentSelfAccess — agent key (numeric ID path)', () => {
  it('allows agent key by numeric id when agent_id matches', () => {
    const user = makeUser({ agent_name: 'repo-steward', agent_id: 42, role: 'operator' })
    expect(requireAgentSelfAccess(user, '42')).toBeNull()
  })

  it('blocks agent key by numeric id when agent_id differs', () => {
    const user = makeUser({ agent_name: 'repo-steward', agent_id: 42, role: 'operator' })
    const result = requireAgentSelfAccess(user, '99')
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })

  it('blocks numeric path when agent_id is not set (fail closed — cannot verify ownership)', () => {
    const user = makeUser({ agent_name: 'repo-steward', agent_id: null, role: 'operator' })
    const result = requireAgentSelfAccess(user, '42')
    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// requireAgentTaskAccess
// ---------------------------------------------------------------------------

describe('requireAgentTaskAccess — human user', () => {
  it('allows human user to access any task regardless of assignment', () => {
    const user = makeUser({ agent_name: null })
    expect(requireAgentTaskAccess(user, 'other-agent')).toBeNull()
    expect(requireAgentTaskAccess(user, null)).toBeNull()
  })
})

describe('requireAgentTaskAccess — admin-scoped key', () => {
  it('allows admin-scoped key to access any task', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'admin' })
    expect(requireAgentTaskAccess(user, 'other-agent')).toBeNull()
    expect(requireAgentTaskAccess(user, null)).toBeNull()
  })
})

describe('requireAgentTaskAccess — agent key', () => {
  it('allows agent key to access its own assigned task', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'operator' })
    expect(requireAgentTaskAccess(user, 'repo-steward')).toBeNull()
  })

  it('blocks agent key from accessing another agent task — enforced', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'operator' })
    const deny = requireAgentTaskAccess(user, 'skill-intake')
    expect(deny).not.toBeNull()
    expect(deny!.status).toBe(403)
  })

  it('blocks agent key when task has no assignment (null)', () => {
    const user = makeUser({ agent_name: 'repo-steward', role: 'operator' })
    const deny = requireAgentTaskAccess(user, null)
    expect(deny).not.toBeNull()
    expect(deny!.status).toBe(403)
  })

  it('admin/user auth behavior remains unchanged', () => {
    const admin = makeUser({ agent_name: 'admin-agent', role: 'admin' })
    expect(requireAgentTaskAccess(admin, 'any-agent')).toBeNull()

    const human = makeUser({ role: 'operator', agent_name: null })
    expect(requireAgentTaskAccess(human, 'any-agent')).toBeNull()
  })
})
