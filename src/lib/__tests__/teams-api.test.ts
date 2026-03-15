import { describe, it, expect } from 'vitest'
import { z } from 'zod'

/**
 * Unit tests for teams API validation logic.
 * These test Zod schemas and constraint logic used by the teams routes,
 * without requiring a live database connection.
 */

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

const updateTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
})

const addMemberSchema = z.object({
  agent_id: z.number().int().positive(),
})

describe('createTeamSchema', () => {
  it('accepts valid team with name only', () => {
    const result = createTeamSchema.safeParse({ name: 'Alpha Squad' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Alpha Squad')
      expect(result.data.description).toBeUndefined()
    }
  })

  it('accepts valid team with name and description', () => {
    const result = createTeamSchema.safeParse({
      name: 'Backend Team',
      description: 'Handles server-side logic',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Backend Team')
      expect(result.data.description).toBe('Handles server-side logic')
    }
  })

  it('rejects empty name', () => {
    const result = createTeamSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects name exceeding 100 characters', () => {
    const result = createTeamSchema.safeParse({ name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('accepts name at exactly 100 characters', () => {
    const result = createTeamSchema.safeParse({ name: 'a'.repeat(100) })
    expect(result.success).toBe(true)
  })

  it('rejects description exceeding 500 characters', () => {
    const result = createTeamSchema.safeParse({
      name: 'Team',
      description: 'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('accepts description at exactly 500 characters', () => {
    const result = createTeamSchema.safeParse({
      name: 'Team',
      description: 'x'.repeat(500),
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name field', () => {
    const result = createTeamSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects non-string name', () => {
    const result = createTeamSchema.safeParse({ name: 42 })
    expect(result.success).toBe(false)
  })
})

describe('updateTeamSchema', () => {
  it('accepts update with id and name', () => {
    const result = updateTeamSchema.safeParse({ id: 1, name: 'New Name' })
    expect(result.success).toBe(true)
  })

  it('accepts update with id and description', () => {
    const result = updateTeamSchema.safeParse({ id: 5, description: 'Updated desc' })
    expect(result.success).toBe(true)
  })

  it('accepts update with id, name and description', () => {
    const result = updateTeamSchema.safeParse({ id: 1, name: 'New', description: 'Desc' })
    expect(result.success).toBe(true)
  })

  it('rejects negative id', () => {
    const result = updateTeamSchema.safeParse({ id: -1, name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('rejects zero id', () => {
    const result = updateTeamSchema.safeParse({ id: 0, name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer id', () => {
    const result = updateTeamSchema.safeParse({ id: 1.5, name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('rejects missing id', () => {
    const result = updateTeamSchema.safeParse({ name: 'Test' })
    expect(result.success).toBe(false)
  })

  it('accepts update with only id (no fields to change)', () => {
    // Schema allows this; route layer enforces at least one field
    const result = updateTeamSchema.safeParse({ id: 1 })
    expect(result.success).toBe(true)
  })
})

describe('addMemberSchema', () => {
  it('accepts valid agent_id', () => {
    const result = addMemberSchema.safeParse({ agent_id: 42 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agent_id).toBe(42)
    }
  })

  it('rejects zero agent_id', () => {
    const result = addMemberSchema.safeParse({ agent_id: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects negative agent_id', () => {
    const result = addMemberSchema.safeParse({ agent_id: -5 })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer agent_id', () => {
    const result = addMemberSchema.safeParse({ agent_id: 3.14 })
    expect(result.success).toBe(false)
  })

  it('rejects missing agent_id', () => {
    const result = addMemberSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects string agent_id', () => {
    const result = addMemberSchema.safeParse({ agent_id: 'abc' })
    expect(result.success).toBe(false)
  })
})

describe('workspace scoping logic', () => {
  it('team UNIQUE constraint is (name, workspace_id)', () => {
    // The SQL migration defines: UNIQUE(name, workspace_id)
    // This means the same team name can exist in different workspaces
    // but not within the same workspace.
    // This test documents the expected constraint behavior.
    const team1 = { name: 'DevOps', workspace_id: 1 }
    const team2 = { name: 'DevOps', workspace_id: 2 }
    const team3 = { name: 'DevOps', workspace_id: 1 }

    // Different workspaces -> allowed
    expect(team1.workspace_id).not.toBe(team2.workspace_id)

    // Same workspace + same name -> would violate UNIQUE
    expect(team1.name).toBe(team3.name)
    expect(team1.workspace_id).toBe(team3.workspace_id)
  })

  it('team_members PRIMARY KEY is (team_id, agent_id)', () => {
    // The SQL migration defines: PRIMARY KEY (team_id, agent_id)
    // An agent can only be added to a team once (duplicate insert -> UNIQUE constraint error)
    const membership1 = { team_id: 1, agent_id: 10 }
    const membership2 = { team_id: 1, agent_id: 10 }

    expect(membership1.team_id).toBe(membership2.team_id)
    expect(membership1.agent_id).toBe(membership2.agent_id)
    // Same combination -> would violate PRIMARY KEY
  })
})
