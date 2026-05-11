'use client'

/**
 * ClientBoot — side-effect import of extensions/client.ts.
 *
 * Rendered once inside the root layout. Responsibilities:
 *   1. Side-effect import `./client` to load panel + nav-item registration
 *      at module-load time.
 *   2. Auto-dismiss the upstream onboarding wizard. Upstream may flip
 *      `showOnboarding` to true based on its own setup detection; the fork
 *      doesn't ship the onboarding flow (we run a different onboarding via
 *      Mission Control extensions). A subscriber keeps `showOnboarding`
 *      pinned to `false` for the lifetime of the page — replaces the older
 *      pattern of editing `onboarding-wizard.tsx` directly, which violated
 *      the upstream-touch contract.
 *
 * This component renders nothing. All the work happens in the imported
 * module + a one-time useEffect subscription.
 */

import { useEffect } from 'react'
import { useMissionControl } from '@/store'
import './client'

export function ClientBoot(): null {
  useEffect(() => {
    // Reset immediately if upstream already pushed showOnboarding=true
    // during initial hydration.
    if (useMissionControl.getState().showOnboarding) {
      useMissionControl.getState().setShowOnboarding(false)
    }
    // Pin showOnboarding to false for the page lifetime. Use the selector
    // form of subscribe (enabled by `subscribeWithSelector` middleware in
    // src/store/index.ts) so the callback only fires on actual transitions
    // of showOnboarding — not on every unrelated store mutation (agent
    // heartbeats, task updates, etc.).
    const unsubscribe = useMissionControl.subscribe(
      (state) => state.showOnboarding,
      (showOnboarding) => {
        if (showOnboarding) useMissionControl.getState().setShowOnboarding(false)
      },
    )
    return unsubscribe
  }, [])

  return null
}
