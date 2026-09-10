import { Readable } from 'node:stream'

export const MAX_WEBHOOK_RESPONSE_BYTES = 1000

export function readLimitedHttpBody(
  res: Readable,
  maxBytes = MAX_WEBHOOK_RESPONSE_BYTES,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const finish = (text: string) => {
      if (settled) return
      settled = true
      res.removeAllListeners('data')
      resolve(text)
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const take = (chunk: Buffer) => {
      if (settled) return
      const remaining = maxBytes - size
      if (remaining <= 0 || chunk.length > remaining) {
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining))
          size = maxBytes
        }
        res.destroy()
        finish(`${Buffer.concat(chunks).toString('utf8')}...`)
        return
      }
      chunks.push(chunk)
      size += chunk.length
    }

    res.on('data', (chunk: Buffer | string) => {
      take(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    res.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    res.on('error', (error: Error) => fail(error))
    res.on('aborted', () => fail(new Error('Webhook response aborted')))
  })
}
