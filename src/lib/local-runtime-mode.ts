export type DashboardMode = 'full' | 'local'

export type RuntimeCapabilities = {
  openclawHome?: boolean | null
  claudeHome?: boolean | null
}

export function shouldUseLocalRuntimeAugmentation(
  dashboardMode: DashboardMode,
  localSessionsAvailable: boolean,
): boolean {
  return dashboardMode === 'local' || localSessionsAvailable
}

export function detectLocalRuntimeAvailability(
  capabilities: RuntimeCapabilities | null | undefined,
): boolean {
  return Boolean(capabilities?.openclawHome || capabilities?.claudeHome)
}
