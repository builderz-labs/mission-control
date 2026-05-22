/**
 * Bug 7 (2026-05-21) — org-membership fallback when active session org
 * differs from MC_CLERK_ORG_SLUG. Without this, cross-tenant nav
 * (sign in to mc-eric, click mc-ceremonia link) loops: satellite
 * handshake → org-slug gate rejects → redirectToSignIn → primary
 * /admin/login → <SignIn forceRedirectUrl> no-ops (already signed in) →
 * STUCK.
 *
 * Fix: if expectedOrg !== activeOrg AND user is a member of expectedOrg,
 * accept the request and override x-clerk-org-slug header to expectedOrg.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOrganizationMembershipListMock = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: {
      getOrganizationMembershipList: getOrganizationMembershipListMock,
    },
  }),
}))

// Import after mock
import {
  userHasOrgMembership,
  __resetMembershipCacheForTests,
} from '@/lib/clerk-org-membership'

describe('userHasOrgMembership', () => {
  beforeEach(() => {
    getOrganizationMembershipListMock.mockReset()
    __resetMembershipCacheForTests()
  })

  it('returns true when user has membership in expected org', async () => {
    getOrganizationMembershipListMock.mockResolvedValue({
      data: [
        { organization: { slug: 'ceremonia' } },
        { organization: { slug: 'ericedmeades' } },
      ],
    })
    const result = await userHasOrgMembership('user_abc', 'ceremonia')
    expect(result).toBe(true)
    expect(getOrganizationMembershipListMock).toHaveBeenCalledWith({
      userId: 'user_abc',
    })
  })

  it('returns false when user is not a member of expected org', async () => {
    getOrganizationMembershipListMock.mockResolvedValue({
      data: [{ organization: { slug: 'other-org' } }],
    })
    const result = await userHasOrgMembership('user_abc', 'ceremonia')
    expect(result).toBe(false)
  })

  it('returns false when Backend API throws (defensive)', async () => {
    getOrganizationMembershipListMock.mockRejectedValue(
      new Error('Network unreachable'),
    )
    const result = await userHasOrgMembership('user_abc', 'ceremonia')
    expect(result).toBe(false)
  })

  it('caches positive result — second call same key skips API', async () => {
    getOrganizationMembershipListMock.mockResolvedValue({
      data: [{ organization: { slug: 'ceremonia' } }],
    })
    const first = await userHasOrgMembership('user_abc', 'ceremonia')
    const second = await userHasOrgMembership('user_abc', 'ceremonia')
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(getOrganizationMembershipListMock).toHaveBeenCalledTimes(1)
  })

  it('caches negative result — second call same key skips API', async () => {
    getOrganizationMembershipListMock.mockResolvedValue({ data: [] })
    const first = await userHasOrgMembership('user_x', 'ceremonia')
    const second = await userHasOrgMembership('user_x', 'ceremonia')
    expect(first).toBe(false)
    expect(second).toBe(false)
    expect(getOrganizationMembershipListMock).toHaveBeenCalledTimes(1)
  })

  it('does not cross-pollute users — different userId triggers fresh fetch', async () => {
    getOrganizationMembershipListMock
      .mockResolvedValueOnce({
        data: [{ organization: { slug: 'ceremonia' } }],
      })
      .mockResolvedValueOnce({ data: [] })
    const aliceResult = await userHasOrgMembership('user_alice', 'ceremonia')
    const bobResult = await userHasOrgMembership('user_bob', 'ceremonia')
    expect(aliceResult).toBe(true)
    expect(bobResult).toBe(false)
    expect(getOrganizationMembershipListMock).toHaveBeenCalledTimes(2)
  })

  it('does not cross-pollute orgs — different orgSlug triggers fresh fetch', async () => {
    getOrganizationMembershipListMock
      .mockResolvedValueOnce({
        data: [{ organization: { slug: 'ceremonia' } }],
      })
      .mockResolvedValueOnce({
        data: [{ organization: { slug: 'ericedmeades' } }],
      })
    const cer = await userHasOrgMembership('user_abc', 'ceremonia')
    const eric = await userHasOrgMembership('user_abc', 'ericedmeades')
    expect(cer).toBe(true)
    expect(eric).toBe(true)
    expect(getOrganizationMembershipListMock).toHaveBeenCalledTimes(2)
  })
})
