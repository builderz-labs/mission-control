/**
 * Fork-regression: ClientBoot onboarding suppression contract.
 *
 * The fork doesn't ship the upstream onboarding wizard. Instead of editing
 * upstream's onboarding-wizard.tsx (which would violate FORK.md's 5-file
 * touch-point contract), ClientBoot mounts a Zustand subscriber that pins
 * `showOnboarding` to `false` for the page lifetime.
 *
 * This test catches the regression class where ClientBoot stops fighting
 * upstream's flag-flip — the symptom would be the wizard re-appearing for
 * users post-rebase. Caught here rather than in a flaky e2e.
 *
 * Co-located with `manifest-registration.test.ts` (panel/nav registration)
 * and `fork-contract.test.ts` (upstream byte-clean check, ships separately).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// Side-effect import in ClientBoot.tsx triggers panel + nav registration.
// Stub it so this test stays focused on the onboarding subscriber and does
// not depend on the panel-registration mocks that manifest-registration.test
// owns.
vi.mock('../client', () => ({}))

import { ClientBoot } from '../ClientBoot'
import { useMissionControl } from '@/store'

describe('ClientBoot — onboarding suppression', () => {
  beforeEach(() => {
    useMissionControl.setState({ showOnboarding: false })
  })

  // Defensive subscriber cleanup: if an assertion throws before a test's
  // explicit `unmount()` runs, the Zustand subscriber from the rendered
  // ClientBoot would survive into the next test. RTL's `cleanup` is
  // idempotent — safe to pair with the explicit unmount calls below.
  afterEach(cleanup)

  it('flips showOnboarding back to false when upstream sets it true post-mount', () => {
    const { unmount } = render(<ClientBoot />)
    useMissionControl.getState().setShowOnboarding(true)
    expect(useMissionControl.getState().showOnboarding).toBe(false)
    unmount()
  })

  it('resets showOnboarding=true that was already set before mount', () => {
    useMissionControl.setState({ showOnboarding: true })
    const { unmount } = render(<ClientBoot />)
    expect(useMissionControl.getState().showOnboarding).toBe(false)
    unmount()
  })

  it('keeps fighting flag-flips for the page lifetime (multiple transitions)', () => {
    const { unmount } = render(<ClientBoot />)
    for (let i = 0; i < 3; i++) {
      useMissionControl.getState().setShowOnboarding(true)
      expect(useMissionControl.getState().showOnboarding).toBe(false)
    }
    unmount()
  })

  it('unsubscribes on unmount (no longer fights flag-flips after teardown)', () => {
    const { unmount } = render(<ClientBoot />)
    unmount()
    useMissionControl.getState().setShowOnboarding(true)
    // Subscriber is gone — flag stays as upstream set it.
    expect(useMissionControl.getState().showOnboarding).toBe(true)
  })

  it('renders nothing into the DOM (component returns null)', () => {
    const { container, unmount } = render(<ClientBoot />)
    expect(container.firstChild).toBeNull()
    unmount()
  })
})
