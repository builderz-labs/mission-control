import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { MAX_WEBHOOK_RESPONSE_BYTES, readLimitedHttpBody } from '@/lib/webhook-response'

describe('readLimitedHttpBody', () => {
  it('returns a small body without truncation', async () => {
    const stream = new PassThrough()
    const pending = readLimitedHttpBody(stream, 16)
    stream.end('ok')
    await expect(pending).resolves.toBe('ok')
  })

  it('stops reading once the cap is reached and marks truncation', async () => {
    const stream = new PassThrough()
    const pending = readLimitedHttpBody(stream, 4)
    stream.write('hello-world')
    stream.end()
    await expect(pending).resolves.toBe('hell...')
  })

  it('caps the default webhook response size used by delivery', async () => {
    const stream = new PassThrough()
    const pending = readLimitedHttpBody(stream)
    stream.end('x'.repeat(MAX_WEBHOOK_RESPONSE_BYTES + 50))
    const text = await pending
    expect(text.endsWith('...')).toBe(true)
    expect(Buffer.byteLength(text.slice(0, -3), 'utf8')).toBe(MAX_WEBHOOK_RESPONSE_BYTES)
  })
})
