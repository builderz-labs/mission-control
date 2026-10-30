export const ZCODE_PERMISSION_MODES = ['build', 'edit', 'plan', 'yolo'] as const

export type ZcodePermissionMode = (typeof ZCODE_PERMISSION_MODES)[number]

const ZCODE_YOLO_MIN_ROLE = 'admin'

function parseAgentConfig(agentConfig: unknown): Record<string, unknown> {
  if (typeof agentConfig === 'string') {
    try {
      const parsed = JSON.parse(agentConfig)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return agentConfig && typeof agentConfig === 'object' && !Array.isArray(agentConfig)
    ? agentConfig as Record<string, unknown>
    : {}
}

/** Read the requested ZCode mode exclusively from operator-managed agent config. */
export function requestedZcodePermissionMode(agentConfig: unknown): ZcodePermissionMode | null {
  const requested = parseAgentConfig(agentConfig).dispatchMode
  if (typeof requested !== 'string') return null
  const normalized = requested.trim().toLowerCase()
  return (ZCODE_PERMISSION_MODES as readonly string[]).includes(normalized)
    ? normalized as ZcodePermissionMode
    : null
}

/**
 * Task dispatch has no request identity because it runs from the scheduler.
 * Yolo authority is therefore established when agent config is written and
 * consumed here without consulting free-form task metadata.
 */
export function resolveZcodePermissionMode(agentConfig: unknown): ZcodePermissionMode {
  return requestedZcodePermissionMode(agentConfig) ?? 'build'
}

/** Only admins may persist YOLO; plan/build/edit remain available to operators. */
export function canWriteZcodePermission(role: string | null | undefined, agentConfig: unknown): boolean {
  return requestedZcodePermissionMode(agentConfig) !== 'yolo' || role === ZCODE_YOLO_MIN_ROLE
}
