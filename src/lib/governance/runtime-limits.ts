import { getDatabase } from '@/lib/db'
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy } from './execution-policy'

let _maintenanceMode = false

export function getPolicy(workspaceId: number): ExecutionPolicy {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'governance.%'"
    ).all() as Array<{ key: string; value: string }>

    const overrides: Partial<ExecutionPolicy> = {}
    for (const row of rows) {
      const field = row.key.replace('governance.', '') as keyof ExecutionPolicy
      if (field === 'maintenanceMode') {
        overrides.maintenanceMode = row.value === 'true'
      } else if (field in DEFAULT_EXECUTION_POLICY) {
        const val = Number(row.value)
        if (!isNaN(val)) (overrides as Record<string, unknown>)[field] = val
      }
    }

    // In-memory flag wins over DB setting
    const maintenanceMode = _maintenanceMode || (overrides.maintenanceMode ?? DEFAULT_EXECUTION_POLICY.maintenanceMode)
    void workspaceId
    return { ...DEFAULT_EXECUTION_POLICY, ...overrides, maintenanceMode }
  } catch {
    return { ...DEFAULT_EXECUTION_POLICY, maintenanceMode: _maintenanceMode }
  }
}

export function setMaintenanceMode(enabled: boolean): void {
  _maintenanceMode = enabled
}

export function isMaintenanceMode(): boolean {
  return _maintenanceMode
}
