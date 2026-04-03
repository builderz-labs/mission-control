export type TaskMetadata = Record<string, unknown>

export interface TaskLike {
  metadata?: string | TaskMetadata | null
}

export interface TaskImplementationTarget {
  implementation_repo?: string
  code_location?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseMetadata(metadata: TaskLike['metadata']): TaskMetadata {
  if (!metadata) return {}

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as TaskMetadata
      }
      return {}
    } catch {
      return {}
    }
  }

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata
  }

  return {}
}

export function resolveTaskImplementationTarget(task: TaskLike): TaskImplementationTarget {
  const metadata = parseMetadata(task.metadata)

  const implementationRepoCandidates = [
    metadata.implementation_repo,
    metadata.implementationRepo,
    metadata.github_repo,
  ]

  const codeLocationCandidates = [
    metadata.code_location,
    metadata.codeLocation,
    metadata.path,
  ]

  const implementation_repo = implementationRepoCandidates.find(isNonEmptyString)
  const code_location = codeLocationCandidates.find(isNonEmptyString)

  return {
    ...(implementation_repo ? { implementation_repo } : {}),
    ...(code_location ? { code_location } : {}),
  }
}
