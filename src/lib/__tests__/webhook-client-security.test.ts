import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Webhook client security contract', () => {
  it('routes all outbound automation requests through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/webhook-panel.tsx'),
      'utf8',
    )

    expect(source.match(/apiFetch(?:<[^>]+>)?\(/g)).toHaveLength(8)
    expect(source).toContain(
      '`/api/webhooks/deliveries?webhook_id=${selectedWebhook}&limit=20`',
    )
    expect(source).toContain('`/api/webhooks?id=${id}`')
    expect(source).not.toMatch(/fetch\((?:['"`])\/api\/(?:webhooks|scheduler)/)

    expect(source).toContain('function webhookErrorPayload<T>')
    expect(source).toContain('function isWebhookTransportFailure')
    expect(source).toContain("apiFetch<Response>('/api/scheduler'")
    expect(source).toContain('status_code: err instanceof ApiError ? err.status : undefined')
    expect(source.match(/fetchWebhooks\(\)/g)).toHaveLength(6)
    expect(source.match(/fetchDeliveries\(\)/g)).toHaveLength(3)
  })
})
