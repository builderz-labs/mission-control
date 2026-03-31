import { describe, expect, it } from 'vitest'
import { assessReleaseAutoUpdateSafety } from '@/lib/repo-update-safety'

describe('assessReleaseAutoUpdateSafety', () => {
  it('allows automatic release updates only on a clean official main checkout', () => {
    const result = assessReleaseAutoUpdateSafety({
      dirty: false,
      remoteUrl: 'https://github.com/builderz-labs/mission-control.git',
      branch: 'main',
      detached: false,
      ahead: 0,
      behind: 2,
    })

    expect(result.safe).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('blocks automatic release updates on custom branches', () => {
    const result = assessReleaseAutoUpdateSafety({
      dirty: false,
      remoteUrl: 'https://github.com/builderz-labs/mission-control.git',
      branch: 'codex/local-customizations',
      detached: false,
      ahead: 0,
      behind: 0,
    })

    expect(result.safe).toBe(false)
    expect(result.reason).toContain('custom branch')
  })

  it('blocks automatic release updates when the working tree is dirty', () => {
    const result = assessReleaseAutoUpdateSafety({
      dirty: true,
      remoteUrl: 'https://github.com/builderz-labs/mission-control.git',
      branch: 'main',
      detached: false,
      ahead: 0,
      behind: 0,
    })

    expect(result.safe).toBe(false)
    expect(result.reason).toContain('uncommitted changes')
  })

  it('blocks automatic release updates for non-official remotes or diverged locals', () => {
    expect(
      assessReleaseAutoUpdateSafety({
        dirty: false,
        remoteUrl: 'git@github.com:j2w/mission-control.git',
        branch: 'main',
        detached: false,
        ahead: 0,
        behind: 0,
      }).safe
    ).toBe(false)

    expect(
      assessReleaseAutoUpdateSafety({
        dirty: false,
        remoteUrl: 'https://github.com/builderz-labs/mission-control.git',
        branch: 'main',
        detached: false,
        ahead: 3,
        behind: 0,
      }).safe
    ).toBe(false)
  })
})
