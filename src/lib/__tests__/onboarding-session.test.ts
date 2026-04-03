import { describe, expect, it, beforeEach } from 'vitest'
import {
  getOnboardingSessionDecision,
  readOnboardingDismissedThisSession,
  markOnboardingDismissedThisSession,
  clearOnboardingDismissedThisSession,
  readOnboardingReplayFromStart,
  markOnboardingReplayFromStart,
  clearOnboardingReplayFromStart,
  ONBOARDING_SESSION_DISMISSED_KEY,
  ONBOARDING_SESSION_REPLAY_KEY,
} from '@/lib/onboarding-session'

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

  it('returns shouldOpen=true, replayFromStart=true when skipped', () => {
    expect(
      getOnboardingSessionDecision({
        isAdmin: true,
        serverShowOnboarding: false,
        completed: false,
        skipped: true,
        dismissedThisSession: false,
      })
    ).toEqual({ shouldOpen: true, replayFromStart: true })
  })

  it('returns shouldOpen=false when nothing triggers open', () => {
    expect(
      getOnboardingSessionDecision({
        isAdmin: true,
        serverShowOnboarding: false,
        completed: false,
        skipped: false,
        dismissedThisSession: false,
      })
    ).toEqual({ shouldOpen: false, replayFromStart: false })
  })
})

describe('dismissed-this-session storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('readOnboardingDismissedThisSession returns false when not set', () => {
    expect(readOnboardingDismissedThisSession()).toBe(false)
  })

  it('markOnboardingDismissedThisSession sets the flag', () => {
    markOnboardingDismissedThisSession()
    expect(readOnboardingDismissedThisSession()).toBe(true)
    expect(window.sessionStorage.getItem(ONBOARDING_SESSION_DISMISSED_KEY)).toBe('1')
  })

  it('clearOnboardingDismissedThisSession removes the flag', () => {
    markOnboardingDismissedThisSession()
    clearOnboardingDismissedThisSession()
    expect(readOnboardingDismissedThisSession()).toBe(false)
    expect(window.sessionStorage.getItem(ONBOARDING_SESSION_DISMISSED_KEY)).toBeNull()
  })
})

describe('replay-from-start storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('readOnboardingReplayFromStart returns false when not set', () => {
    expect(readOnboardingReplayFromStart()).toBe(false)
  })

  it('markOnboardingReplayFromStart sets the flag', () => {
    markOnboardingReplayFromStart()
    expect(readOnboardingReplayFromStart()).toBe(true)
    expect(window.sessionStorage.getItem(ONBOARDING_SESSION_REPLAY_KEY)).toBe('1')
  })

  it('clearOnboardingReplayFromStart removes the flag', () => {
    markOnboardingReplayFromStart()
    clearOnboardingReplayFromStart()
    expect(readOnboardingReplayFromStart()).toBe(false)
    expect(window.sessionStorage.getItem(ONBOARDING_SESSION_REPLAY_KEY)).toBeNull()
  })
})
