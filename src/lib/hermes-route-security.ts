import { z } from 'zod'
import { redactSecrets } from '@/lib/secret-scanner'

const MAX_COMMAND_OUTPUT_LENGTH = 16_000
const SAFE_CONFIG_VALUE = /^(?!-)[A-Za-z0-9._:/@+-]{1,200}$/

export const hermesMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install-hook') }).strict(),
  z.object({ action: z.literal('uninstall-hook') }).strict(),
  z.object({
    action: z.literal('set-env'),
    key: z.enum(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'NOUS_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']),
    value: z.string().min(1).max(20_000),
  }).strict(),
  z.object({
    action: z.literal('set-soul'),
    content: z.string().max(100_000),
  }).strict(),
  z.object({
    action: z.literal('run-oauth-model'),
    provider: z.string().trim().regex(SAFE_CONFIG_VALUE).optional(),
    model: z.string().trim().regex(SAFE_CONFIG_VALUE).optional(),
    authMethod: z.literal('device_code').optional(),
  }).strict(),
  z.object({
    action: z.literal('run-command'),
    command: z.string().trim().min(1).max(500),
  }).strict(),
])

export function parseHermesSetupCommand(command: string): string[] | null {
  const parts = command.trim().split(/\s+/)
  if (parts[0] !== 'hermes') return null

  if (parts.length === 2 && ['status', 'doctor', 'version'].includes(parts[1])) {
    return parts.slice(1)
  }

  if (
    parts.length === 5
    && parts[1] === 'config'
    && parts[2] === 'set'
    && ['model.provider', 'model.default'].includes(parts[3])
    && SAFE_CONFIG_VALUE.test(parts[4])
  ) {
    return parts.slice(1)
  }

  return null
}

export function formatHermesCommandOutput(...parts: Array<string | undefined>): string {
  const combined = parts.filter(Boolean).join('\n').trim()
  const withoutControls = combined
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u009b[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const redacted = redactSecrets(withoutControls).replace(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)\s*[=:]\s*)[^\r\n\s]+/gi,
    '$1***REDACTED***',
  )

  if (redacted.length <= MAX_COMMAND_OUTPUT_LENGTH) return redacted
  return `${redacted.slice(0, MAX_COMMAND_OUTPUT_LENGTH)}\n…[truncated]`
}
