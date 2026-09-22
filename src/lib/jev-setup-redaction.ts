import { redactSecrets } from '@/lib/secret-scanner'

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const NAMED_SECRET = /\b(api[_-]?key|access[_-]?token|token|password|secret|authorization|credentials?|key)\b(\s*[=:]\s*)([^\s,;]+)/gi
const JSON_SECRET = /("(?:api[_-]?key|access[_-]?token|token|password|secret|authorization|credentials?|key)"\s*:\s*)"(?:\\.|[^"\\])*"/gi
const TOKEN_PREFIX = /\b(?:sk|ghp|gho|doppler)[_-][A-Za-z0-9_-]{12,}\b/g
const SENSITIVE_KEY = /(?:password|token|secret|authorization|credentials?|key)/i

export function redactJevSetupText(value: string): string {
  const withoutPrivateKeys = value.replace(PRIVATE_KEY, '[redacted-private-key]')
  return redactSecrets(withoutPrivateKeys)
    .replace(BEARER, 'Bearer [redacted]')
    .replace(JSON_SECRET, '$1"[redacted]"')
    .replace(NAMED_SECRET, '$1$2[redacted]')
    .replace(TOKEN_PREFIX, '[redacted]')
}

export function redactJevSetupValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return redactJevSetupText(value)
  if (Array.isArray(value)) return value.map((item) => redactJevSetupValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([itemKey, item]) => [itemKey, redactJevSetupValue(item, itemKey)]),
    )
  }
  return value
}

export function serializeRedactedJevSetupValue(value: unknown): string {
  return JSON.stringify(redactJevSetupValue(value))
}
