import net from 'net'

interface ProvisionerRequest {
  token: string
  command: string
  args: string[]
  timeoutMs: number
  dryRun: boolean
  stepKey?: string
}

interface ProvisionerResponse {
  ok: boolean
  code?: number
  stdout?: string
  stderr?: string
  skipped?: boolean
  error?: string
}

const DEFAULT_SOCKET = process.env.MC_PROVISIONER_SOCKET || '/run/mc-provisioner.sock'

export async function runProvisionerCommand(input: {
  command: string
  args: string[]
  timeoutMs: number
  dryRun: boolean
  stepKey?: string
}) {
  const token = String(process.env.MC_PROVISIONER_TOKEN || '')
  if (!token) {
    throw new Error('MC_PROVISIONER_TOKEN is not configured')
  }

  const payload: ProvisionerRequest = {
    token,
    command: input.command,
    args: input.args,
    timeoutMs: input.timeoutMs,
    dryRun: input.dryRun,
    stepKey: input.stepKey,
  }

  const response = await callProvisioner(payload)
  if (!response.ok) {
    const detail = [response.error, response.stderr, response.stdout].filter(Boolean).join(' | ')
    throw new Error(detail || 'Provisioner command failed')
  }

  return {
    stdout: String(response.stdout || ''),
    stderr: String(response.stderr || ''),
    code: typeof response.code === 'number' ? response.code : 1,
    skipped: !!response.skipped,
  }
}

function callProvisioner(payload: ProvisionerRequest): Promise<ProvisionerResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: DEFAULT_SOCKET })
    let raw = ''

    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Provisioner socket timeout'))
    }, Math.max(2000, payload.timeoutMs + 2000))

    socket.on('connect', () => {
      socket.write(JSON.stringify(payload) + '\n')
    })

    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8')
      const idx = raw.indexOf('\n')
      if (idx !== -1) {
        const line = raw.slice(0, idx)
        clearTimeout(timeout)
        socket.end()
        try {
          const parsed = JSON.parse(line) as ProvisionerResponse
          resolve(parsed)
        } catch (err) {
          reject(new Error(`Invalid provisioner response: ${(err as Error).message}`))
        }
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Provisioner socket error: ${err.message}`))
    })

    socket.on('close', () => {
      if (!raw) {
        clearTimeout(timeout)
      }
    })
  })
}
