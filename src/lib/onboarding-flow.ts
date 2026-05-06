export interface OnboardingStepDefinition {
  id: string
  title: string
}

export const BASE_STEPS: OnboardingStepDefinition[] = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'interface-mode', title: 'Interface' },
  { id: 'credentials', title: 'Credentials' },
]

export const GATEWAY_STEPS: OnboardingStepDefinition[] = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'interface-mode', title: 'Interface' },
  { id: 'gateway-link', title: 'Gateway' },
  { id: 'credentials', title: 'Credentials' },
]

/** All canonical step IDs — superset for API validation and persistence. */
export const ALL_KNOWN_STEPS: OnboardingStepDefinition[] = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'interface-mode', title: 'Interface' },
  { id: 'gateway-link', title: 'Gateway' },
  { id: 'credentials', title: 'Credentials' },
]

export function getWizardSteps(gatewayConnected: boolean): OnboardingStepDefinition[] {
  return gatewayConnected ? GATEWAY_STEPS : BASE_STEPS
}

export function clampWizardStep(step: number, stepsLength: number): number {
  if (stepsLength <= 0) return 0
  if (step < 0) return 0
  if (step >= stepsLength) return stepsLength - 1
  return step
}

export function stepIdAt(step: number, steps: OnboardingStepDefinition[]): string | undefined {
  return steps[clampWizardStep(step, steps.length)]?.id
}
