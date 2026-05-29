import { describe, expect, it } from 'vitest'
import type { ContainerDefinition } from '@aws-sdk/client-ecs'
import {
  ChannelInput,
  extractOwnerSlackId,
  normalizeChannelInput,
  serializeChannelInputs,
  validateChannelInputs,
  validatePrimaryAssignment,
} from '@/extensions/fleet/lib/slack-channel-injection'

/**
 * Unit coverage for the #494 role taxonomy additions to the shared
 * Slack channel-injection helpers. The on-the-wire shapes asserted
 * here MUST match the golden expectations init-config.sh consumes
 * (ender-stack/services/companion/openclaw/init/test-init-config.sh)
 * — MC is the authoritative validator, init-config sanitizes.
 */

const OWNER = 'U01ABCDEF23'
const USER_B = 'U07XYZ12345'

function parse(json: string): { channels: Record<string, unknown>[] } {
  return JSON.parse(json)
}

describe('normalizeChannelInput (#494)', () => {
  it('string → legacy mention-gated, no role keys', () => {
    expect(normalizeChannelInput('C0123456789')).toEqual({
      id: 'C0123456789',
      requireMention: true,
    })
  })

  it('legacy object (no role) preserves requireMention, no role keys', () => {
    expect(
      normalizeChannelInput({ id: 'C0123456789', requireMention: false }),
    ).toEqual({ id: 'C0123456789', requireMention: false })
  })

  it('role form OMITS requireMention (derived downstream)', () => {
    const out = normalizeChannelInput({
      id: 'C0123456789',
      role: 'primary',
      assignedUsers: [OWNER],
    })
    expect(out).toEqual({
      id: 'C0123456789',
      role: 'primary',
      assignedUsers: [OWNER],
    })
    expect('requireMention' in out).toBe(false)
  })

  it('role form carries accessMode + empty assignedUsers when provided', () => {
    expect(
      normalizeChannelInput({
        id: 'C0123456789',
        role: 'active',
        accessMode: 'preferred',
        assignedUsers: [],
      }),
    ).toEqual({
      id: 'C0123456789',
      role: 'active',
      accessMode: 'preferred',
      assignedUsers: [],
    })
  })

  it('monitor without assignedUsers stays minimal', () => {
    expect(normalizeChannelInput({ id: 'C0123456789', role: 'monitor' })).toEqual(
      { id: 'C0123456789', role: 'monitor' },
    )
  })

  it('drops an explicit requireMention when a role is present (derived downstream)', () => {
    // An operator migrating a legacy {id, requireMention} object by adding
    // a role: requireMention is silently superseded by role(+accessMode)
    // downstream. Lock that the wire shape carries no stale requireMention.
    const out = normalizeChannelInput({
      id: 'C0123456789',
      role: 'active',
      accessMode: 'exclusive',
      requireMention: false,
      assignedUsers: [OWNER],
    })
    expect('requireMention' in out).toBe(false)
    expect(out).toEqual({
      id: 'C0123456789',
      role: 'active',
      accessMode: 'exclusive',
      assignedUsers: [OWNER],
    })
  })
})

describe('serializeChannelInputs (#494)', () => {
  it('legacy payload stays byte-identical (no new keys)', () => {
    const r = serializeChannelInputs(['C0123456789'])
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.json).toBe('{"channels":[{"id":"C0123456789","requireMention":true}]}')
  })

  it('primary + assignedUsers serializes role form without requireMention', () => {
    const r = serializeChannelInputs([
      { id: 'C0123456789', role: 'primary', assignedUsers: [OWNER] },
    ])
    if ('error' in r) throw new Error(r.error)
    expect(r.json).toBe(
      '{"channels":[{"id":"C0123456789","role":"primary","assignedUsers":["' +
        OWNER +
        '"]}]}',
    )
  })

  it('monitor with assignedUsers preserves them on the wire (MC permissive; init-config ignores)', () => {
    // Documented contract: MC does not strip assignedUsers for monitor;
    // init-config.sh is what drops them. This locks the serialized shape.
    const r = serializeChannelInputs([
      { id: 'C0123456789', role: 'monitor', assignedUsers: [OWNER] },
    ])
    if ('error' in r) throw new Error(r.error)
    expect(parse(r.json).channels[0]).toEqual({
      id: 'C0123456789',
      role: 'monitor',
      assignedUsers: [OWNER],
    })
  })

  it('dedupes by id; object overwrites earlier string', () => {
    const r = serializeChannelInputs([
      'C0123456789',
      { id: 'C0123456789', role: 'active', assignedUsers: [USER_B] },
    ])
    if ('error' in r) throw new Error(r.error)
    const parsed = parse(r.json)
    expect(parsed.channels).toHaveLength(1)
    expect(parsed.channels[0]).toEqual({
      id: 'C0123456789',
      role: 'active',
      assignedUsers: [USER_B],
    })
  })
})

describe('validateChannelInputs (#494 stateless checks)', () => {
  it('accepts a valid role payload', () => {
    expect(
      validateChannelInputs([
        { id: 'C0123456789', role: 'primary', assignedUsers: [OWNER] },
        { id: 'C9876543210', role: 'active', accessMode: 'preferred', assignedUsers: [USER_B] },
        { id: 'G1234567890', role: 'monitor' },
      ]),
    ).toBeNull()
  })

  it('rejects an unknown role', () => {
    const err = validateChannelInputs([
      { id: 'C0123456789', role: 'primay' as unknown as 'primary' },
    ])
    expect(err).toMatch(/role must be one of/)
  })

  it('rejects an unknown accessMode', () => {
    const err = validateChannelInputs([
      { id: 'C0123456789', role: 'active', accessMode: 'eager' as unknown as 'exclusive' },
    ])
    expect(err).toMatch(/accessMode must be one of/)
  })

  it('rejects accessMode on a non-active role', () => {
    expect(
      validateChannelInputs([
        { id: 'C0123456789', role: 'primary', accessMode: 'exclusive' },
      ]),
    ).toMatch(/accessMode is only valid for role "active"/)
    expect(
      validateChannelInputs([
        { id: 'C0123456789', role: 'monitor', accessMode: 'preferred' },
      ]),
    ).toMatch(/accessMode is only valid for role "active"/)
  })

  it('rejects a malformed assignedUsers entry', () => {
    const err = validateChannelInputs([
      { id: 'C0123456789', role: 'active', assignedUsers: [OWNER, 'not-a-user'] },
    ])
    expect(err).toMatch(/Slack user-ID format/)
  })

  it('rejects assignedUsers that is not an array', () => {
    const err = validateChannelInputs([
      { id: 'C0123456789', role: 'active', assignedUsers: 'U01ABCDEF23' as unknown as string[] },
    ])
    expect(err).toMatch(/must be an array/)
  })

  it('rejects assignedUsers without a role (would be silently dropped otherwise)', () => {
    // No role → normalizeChannelInput takes the legacy path and drops
    // assignedUsers. Reject so the operator's allowlist intent isn't
    // swallowed with a misleading 200.
    const err = validateChannelInputs([
      { id: 'C0123456789', assignedUsers: [OWNER] } as unknown as {
        id: string
        assignedUsers: string[]
      },
    ])
    expect(err).toMatch(/assignedUsers requires a role/)
  })
})

describe('extractOwnerSlackId (#494)', () => {
  const withInit = (env: { name: string; value: string }[]): ContainerDefinition[] => [
    { name: 'gateway' } as ContainerDefinition,
    { name: 'init-config', environment: env } as ContainerDefinition,
  ]

  it('reads a valid owner from the init-config container env', () => {
    expect(
      extractOwnerSlackId(withInit([{ name: 'AGENT_OWNER_SLACK_ID', value: OWNER }])),
    ).toBe(OWNER)
  })

  it('returns undefined when the owner is malformed', () => {
    expect(
      extractOwnerSlackId(withInit([{ name: 'AGENT_OWNER_SLACK_ID', value: 'nope' }])),
    ).toBeUndefined()
  })

  it('returns undefined when the env var is absent', () => {
    expect(extractOwnerSlackId(withInit([]))).toBeUndefined()
  })
})

describe('validatePrimaryAssignment (#494 owner-aware)', () => {
  const primaryEmpty: ChannelInput[] = [
    { id: 'C0123456789', role: 'primary', assignedUsers: [] },
  ]

  it('rejects primary + empty assignedUsers when no owner', () => {
    expect(validatePrimaryAssignment(primaryEmpty, undefined)).toMatch(
      /no usable owner Slack ID/,
    )
  })

  it('allows primary + empty assignedUsers when a valid owner exists', () => {
    expect(validatePrimaryAssignment(primaryEmpty, OWNER)).toBeNull()
  })

  it('allows primary + explicit assignedUsers regardless of owner', () => {
    expect(
      validatePrimaryAssignment(
        [{ id: 'C0123456789', role: 'primary', assignedUsers: [USER_B] }],
        undefined,
      ),
    ).toBeNull()
  })

  it('ignores non-primary channels (active/monitor) for this check', () => {
    expect(
      validatePrimaryAssignment(
        [
          { id: 'C0123456789', role: 'active', assignedUsers: [] },
          { id: 'C9876543210', role: 'monitor' },
        ],
        undefined,
      ),
    ).toBeNull()
  })

  it('treats a malformed owner as no owner', () => {
    expect(validatePrimaryAssignment(primaryEmpty, 'bogus')).toMatch(
      /no usable owner Slack ID/,
    )
  })

  it('permits multiple primary channels (init-config injects owner into each)', () => {
    // No single-primary constraint: init-config.sh loops over every
    // primary and injects the owner. Both empty primaries are satisfied
    // by a valid owner; with no owner, both would be rejected.
    const twoPrimaries: ChannelInput[] = [
      { id: 'C0123456789', role: 'primary', assignedUsers: [] },
      { id: 'C9876543210', role: 'primary', assignedUsers: [] },
    ]
    expect(validatePrimaryAssignment(twoPrimaries, OWNER)).toBeNull()
    expect(validatePrimaryAssignment(twoPrimaries, undefined)).toMatch(
      /no usable owner Slack ID/,
    )
  })
})
