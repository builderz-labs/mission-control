export interface ReleaseAutoUpdateContext {
  dirty: boolean
  remoteUrl: string | null
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
}

export interface ReleaseAutoUpdateAssessment {
  safe: boolean
  reason: string | null
}

function isOfficialMissionControlRemote(remoteUrl: string | null): boolean {
  if (!remoteUrl) return false
  return /github\.com[:/]builderz-labs\/mission-control(?:\.git)?$/i.test(remoteUrl.trim())
}

export function assessReleaseAutoUpdateSafety(
  context: ReleaseAutoUpdateContext
): ReleaseAutoUpdateAssessment {
  if (context.dirty) {
    return {
      safe: false,
      reason: 'Automatic updates are disabled because this checkout has uncommitted changes.',
    }
  }

  if (!isOfficialMissionControlRemote(context.remoteUrl)) {
    return {
      safe: false,
      reason: 'Automatic updates are disabled because this Mission Control checkout uses a non-official remote.',
    }
  }

  if (context.detached) {
    return {
      safe: false,
      reason: 'Automatic updates are disabled because this Mission Control checkout is detached from a branch.',
    }
  }

  if (!context.branch || !['main', 'master'].includes(context.branch)) {
    return {
      safe: false,
      reason: 'Automatic updates are disabled because this Mission Control checkout is on a custom branch.',
    }
  }

  if (context.ahead > 0) {
    return {
      safe: false,
      reason: 'Automatic updates are disabled because this Mission Control checkout has local commits not on origin.',
    }
  }

  return {
    safe: true,
    reason: null,
  }
}
