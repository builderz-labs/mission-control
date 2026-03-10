import type { OnboardingStepDefinition } from '@/lib/onboarding-flow'

export function parseCompletedSteps(raw: string, validSteps: readonly OnboardingStepDefinition[]): string[] {
  const valid = new Set(validSteps.map((step) => step.id))

  try {
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []

    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const value of parsed) {
      if (typeof value !== 'string') continue
      if (!valid.has(value)) continue
      if (seen.has(value)) continue
      seen.add(value)
      cleaned.push(value)
    }
    return cleaned
  } catch {
    return []
  }
}

export function nextIncompleteStepIndex(
  steps: readonly OnboardingStepDefinition[],
  completedSteps: readonly string[]
): number {
  if (steps.length === 0) return 0
  const completed = new Set(completedSteps)
  const index = steps.findIndex((step) => !completed.has(step.id))
  return index === -1 ? steps.length - 1 : index
}

export function shouldShowOnboarding(params: {
  completed: boolean
  skipped: boolean
  isAdmin: boolean
}): boolean {
  return !params.completed && !params.skipped && params.isAdmin
}

export function markStepCompleted(
  existingCompletedSteps: readonly string[],
  stepId: string,
  validSteps: readonly OnboardingStepDefinition[]
): string[] {
  const valid = new Set(validSteps.map((step) => step.id))
  if (!valid.has(stepId)) return [...existingCompletedSteps]

  const completed = parseCompletedSteps(JSON.stringify(existingCompletedSteps), validSteps)
  if (completed.includes(stepId)) return completed
  return [...completed, stepId]
}
