// ---------------------------------------------------------------------------
// Public API for the security-scan subsystem
// All consumers import from '@/lib/security-scan' (the barrel file) or
// directly from this module.
// ---------------------------------------------------------------------------

export type { CheckSeverity, FixSafety, Check, Category, ScanResult } from './types'
export { FIX_SAFETY, SEVERITY_WEIGHT, INSECURE_PASSWORDS } from './types'
export { scoreCategory, readSystemUptimeSeconds, runSecurityScan } from './report'
export { scanCredentials, scanNetwork, scanOpenClaw, scanRuntime, scanOS } from './scanners'
