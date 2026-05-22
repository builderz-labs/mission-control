/**
 * Bug 7 (2026-05-21) — org-membership fallback for cross-tenant nav.
 *
 * When a user signed in to org A navigates to a satellite that requires
 * org B, Clerk's session keeps A as the active org. proxy.ts's
 * MC_CLERK_ORG_SLUG gate would otherwise reject the request and trigger
 * an infinite redirect loop (see project_mc_od_chat_demo_session6+7).
 *
 * This helper queries Clerk Backend API for the user's full membership
 * list and reports whether they are a member of the expected org. Result
 * cached in process memory for MEMBERSHIP_TTL_MS to avoid an extra Clerk
 * round-trip per request.
 */
import { clerkClient } from '@clerk/nextjs/server'

const MEMBERSHIP_TTL_MS = 60_000

interface CacheEntry {
  value: boolean
  expiry: number
}

const membershipCache = new Map<string, CacheEntry>()

function cacheKey(userId: string, orgSlug: string): string {
  return `${userId}::${orgSlug}`
}

export async function userHasOrgMembership(
  userId: string,
  orgSlug: string,
): Promise<boolean> {
  if (!userId || !orgSlug) return false

  const key = cacheKey(userId, orgSlug)
  const cached = membershipCache.get(key)
  if (cached && cached.expiry > Date.now()) {
    return cached.value
  }

  try {
    const client = await clerkClient()
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
    })
    const isMember = memberships.data.some(
      (m: { organization?: { slug?: string } }) =>
        m.organization?.slug === orgSlug,
    )
    membershipCache.set(key, {
      value: isMember,
      expiry: Date.now() + MEMBERSHIP_TTL_MS,
    })
    return isMember
  } catch {
    return false
  }
}

// Test-only — clear cache between describe blocks
export function __resetMembershipCacheForTests(): void {
  membershipCache.clear()
}
