import { spawnSync } from 'node:child_process'

const HOST_RE = /^[A-Za-z0-9.:-]+$/

export function isPortOpenSync(host: string, port: number, timeoutMs = 400): boolean {
  if (!HOST_RE.test(host)) return false
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  const wait = Math.max(50, Math.min(timeoutMs, 2000))
  const script = [
    "const s=require('net').connect(",
    String(port),
    ',',
    JSON.stringify(host),
    ',()=>process.exit(0));',
    's.on("error",()=>process.exit(1));',
    `s.setTimeout(${wait},function(){this.destroy();process.exit(1)})`,
  ].join('')
  const result = spawnSync(process.execPath, ['-e', script], {
    timeout: wait + 400,
    stdio: 'ignore',
  })
  return result.status === 0
}
