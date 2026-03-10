# Onboarding + Walkthrough hardening plan

Base branch: `fix/refactor`
Working branch: `fix/refactor-onboarding-walkthrough`

## Goals
- Verify current onboarding and walkthrough flows are functional.
- Fix edge cases for first-run, skip, replay, and recovery states.
- Improve UX discoverability of walkthrough entry points.
- Add regression tests to keep flows stable.

## Phase 1: audit and test map
1. Identify current onboarding/walkthrough code paths.
2. Document triggers, persistence flags, and routing.
3. Add failing tests for first-run, skip, replay, and already-seen states.

## Phase 2: implementation hardening
1. Fix state transitions and persistence updates.
2. Ensure walkthrough can be reopened from primary UI.
3. Add visible hint/help entry to improve discoverability.
4. Handle corrupted or partial onboarding state safely.

## Phase 3: verification
1. Run targeted tests for onboarding/walkthrough.
2. Run full project checks.
3. Validate end-to-end flow manually in local dev.

## Deliverables
- Code changes in onboarding/walkthrough modules
- Automated tests covering key onboarding paths
- Updated docs/help text for walkthrough discoverability
