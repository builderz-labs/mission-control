// ---------------------------------------------------------------------------
// Types and constants for the security scan subsystem
// ---------------------------------------------------------------------------

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'
export type FixSafety = 'safe' | 'requires-restart' | 'requires-review' | 'manual-only'

export interface Check {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  fix: string
  severity?: CheckSeverity
  fixSafety?: FixSafety
  platform?: 'linux' | 'darwin' | 'win32' | 'all'
}

export interface Category {
  score: number
  checks: Check[]
}

export interface ScanResult {
  overall: 'secure' | 'hardened' | 'needs-attention' | 'at-risk'
  score: number
  timestamp: number
  categories: {
    credentials: Category
    network: Category
    openclaw: Category
    runtime: Category
    os: Category
  }
}

// ---------------------------------------------------------------------------
// Fix safety map — exported for agent endpoint and UI
// ---------------------------------------------------------------------------

export const FIX_SAFETY: Record<string, FixSafety> = {
  env_permissions: 'safe',
  config_permissions: 'safe',
  world_writable: 'safe',
  hsts_enabled: 'requires-restart',
  cookie_secure: 'requires-restart',
  allowed_hosts: 'requires-restart',
  rate_limiting: 'requires-restart',
  api_key_set: 'requires-restart',
  log_redaction: 'requires-restart',
  dm_isolation: 'requires-restart',
  fs_workspace_only: 'requires-restart',
  exec_restricted: 'requires-review',
  gateway_auth: 'requires-review',
  gateway_bind: 'requires-review',
  elevated_disabled: 'requires-review',
  control_ui_device_auth: 'requires-review',
  control_ui_insecure_auth: 'requires-review',
}

// Weights used for severity-adjusted scoring across all scan categories
export const SEVERITY_WEIGHT: Record<CheckSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// Passwords that are known-bad defaults and must be flagged immediately
export const INSECURE_PASSWORDS = new Set([
  'admin',
  'password',
  'change-me-on-first-login',
  'changeme',
  'testpass123',
])
