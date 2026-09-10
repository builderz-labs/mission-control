import { spawn } from 'node:child_process'

export function capture(command: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(stdout)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
  })
}
