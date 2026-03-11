import { describe, expect, it } from 'vitest'
import { getOnboardingSessionDecision } from '@/lib/onboarding-session'

describe('onboarding-session', () => {
  it('opens onboarding for admins when the server says it should show', () => {
    expect(
      getOnboardingSessionDecision({
        isAdmin: true,
        serverShowOnboarding: true,
        completed: false,
        skipped: false,
        dismissedThisSession: false,
      })
    ).toEqual({ shouldOpen: true, replayFromStart: false })
  })

  it('replays onboarding from the start on a fresh session after completion', () => {
    expect(
      getOnboardingSessionDecision({
        isAdmin: true,
        serverShowOnboarding: false,
        completed: true,
        skipped: false,
        dismissedThisSession: false,
      })
    ).toEqual({ shouldOpen: true, replayFromStart: true })
  })

  it('does not reopen onboarding once dismissed in the current session', () => {
    expect(
      getOnboardingSessionDecision({
        isAdmin: true,
        serverShowOnboarding: false,
        completed: true,
        skipped: false,
        dismissedThisSession: true,
      })
    ).toEqual({ shouldOpen: false, replayFromStart: false })
  })

  it('never opens onboarding for non-admin users', () => {
    expect(
      getOnboardingSessionDecision({
        isAdmin: false,
        serverShowOnboarding: true,
        completed: false,
        skipped: false,
        dismissedThisSession: false,
      })
    ).toEqual({ shouldOpen: false, replayFromStart: false })
  })
})
