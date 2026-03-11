export const ONBOARDING_SESSION_DISMISSED_KEY = 'mc-onboarding-dismissed'
export const ONBOARDING_SESSION_REPLAY_KEY = 'mc-onboarding-replay'

export interface OnboardingSessionDecisionParams {
  isAdmin: boolean
  serverShowOnboarding: boolean
  completed: boolean
  skipped: boolean
  dismissedThisSession: boolean
}

export interface OnboardingSessionDecision {
  shouldOpen: boolean
  replayFromStart: boolean
}

export function getOnboardingSessionDecision(
  params: OnboardingSessionDecisionParams
): OnboardingSessionDecision {
  if (!params.isAdmin || params.dismissedThisSession) {
    return { shouldOpen: false, replayFromStart: false }
  }

  if (params.serverShowOnboarding) {
    return { shouldOpen: true, replayFromStart: false }
  }

  if (params.completed || params.skipped) {
    return { shouldOpen: true, replayFromStart: true }
  }

  return { shouldOpen: false, replayFromStart: false }
}

export function readOnboardingDismissedThisSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(ONBOARDING_SESSION_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingDismissedThisSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(ONBOARDING_SESSION_DISMISSED_KEY, '1')
  } catch {}
}

export function clearOnboardingDismissedThisSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(ONBOARDING_SESSION_DISMISSED_KEY)
  } catch {}
}

export function readOnboardingReplayFromStart(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(ONBOARDING_SESSION_REPLAY_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingReplayFromStart(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(ONBOARDING_SESSION_REPLAY_KEY, '1')
  } catch {}
}

export function clearOnboardingReplayFromStart(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(ONBOARDING_SESSION_REPLAY_KEY)
  } catch {}
}
