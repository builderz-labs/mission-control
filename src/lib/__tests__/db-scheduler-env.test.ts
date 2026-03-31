import { describe, expect, it } from 'vitest'

import { shouldStartRuntimeScheduler } from '../db'

describe('shouldStartRuntimeScheduler', () => {
  it('disables the runtime scheduler when explicitly requested', () => {
    expect(
      shouldStartRuntimeScheduler({
        env: { MISSION_CONTROL_DISABLE_SCHEDULER: '1' } as unknown as NodeJS.ProcessEnv,
        isBuildPhase: false,
        isTestMode: false,
      })
    ).toBe(false)

    expect(
      shouldStartRuntimeScheduler({
        env: { MISSION_CONTROL_DISABLE_SCHEDULER: 'true' } as unknown as NodeJS.ProcessEnv,
        isBuildPhase: false,
        isTestMode: false,
      })
    ).toBe(false)
  })

  it('still disables the scheduler during build and test phases', () => {
    expect(
      shouldStartRuntimeScheduler({
        env: {} as unknown as NodeJS.ProcessEnv,
        isBuildPhase: true,
        isTestMode: false,
      })
    ).toBe(false)

    expect(
      shouldStartRuntimeScheduler({
        env: {} as unknown as NodeJS.ProcessEnv,
        isBuildPhase: false,
        isTestMode: true,
      })
    ).toBe(false)
  })

  it('keeps the scheduler enabled for normal runtime installs', () => {
    expect(
      shouldStartRuntimeScheduler({
        env: {} as unknown as NodeJS.ProcessEnv,
        isBuildPhase: false,
        isTestMode: false,
      })
    ).toBe(true)
  })
})
