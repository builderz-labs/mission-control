export interface FlyMachinesClientOptions {
  apiToken?: string
  appName?: string
  baseUrl?: string
  timeoutMs?: number
  retries?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export interface FlyMachineCreateRequest {
  name?: string
  region?: string
  config: Record<string, unknown>
}

export interface FlyMachineResponse {
  id: string
  state?: string
  name?: string
  config?: Record<string, unknown>
}

export class FlyMachinesError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'FlyMachinesError'
  }
}

function enabled(options: FlyMachinesClientOptions): options is FlyMachinesClientOptions & { apiToken: string; appName: string } {
  return Boolean(options.apiToken?.trim() && options.appName?.trim())
}

function retryable(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500
}

export class FlyMachinesClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: FlyMachinesClientOptions) {
    this.baseUrl = (options.baseUrl || 'https://api.machines.dev/v1').replace(/\/$/, '')
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 15_000)
    this.retries = Math.max(0, options.retries ?? 2)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): FlyMachinesClient {
    return new FlyMachinesClient({ apiToken: env.FLY_API_TOKEN, appName: env.MC_FLY_WORKER_APP || env.FLY_APP_NAME })
  }

  /** Retiring a worker app must not strand the jobs still running on it. */
  withApp(appName: string): FlyMachinesClient {
    return appName === this.options.appName ? this : new FlyMachinesClient({ ...this.options, appName })
  }

  get appName(): string | undefined {
    return this.options.appName
  }

  isEnabled(): boolean {
    return enabled(this.options)
  }

  async listMachines(): Promise<FlyMachineResponse[]> {
    return this.request<FlyMachineResponse[]>('/machines', 'GET')
  }

  async createMachine(input: FlyMachineCreateRequest): Promise<FlyMachineResponse> {
    if (!input.name) throw new FlyMachinesError('A stable launch name is required.')
    try {
      return await this.request<FlyMachineResponse>('/machines', 'POST', input, 0)
    } catch (error) {
      // Retry observation, never an ambiguous create. Keep its reservation.
      for (let attempt = 0; attempt < 2; attempt++) {
        await this.sleep(500 * (attempt + 1))
        const found = (await this.listMachines()).find(machine => machine.name === input.name)
        if (found) return found
      }
      throw error
    }
  }

  async readWorkerState(id: string): Promise<{ stdout: string; stderr?: string; exit_code: number }> {
    return this.request(`/machines/${encodeURIComponent(id)}/exec`, 'POST', {
      command: ['cat', '/tmp/mc-worker-state.json'], timeout: 5,
    })
  }

  async stopMachine(id: string): Promise<FlyMachineResponse> {
    return this.request<FlyMachineResponse>(`/machines/${encodeURIComponent(id)}/stop`, 'POST')
  }

  async destroyMachine(id: string): Promise<void> {
    try { await this.request<unknown>(`/machines/${encodeURIComponent(id)}?force=true`, 'DELETE') }
    catch (error) {
      if (error instanceof FlyMachinesError && error.status === 404) return
      throw error
    }
    try { await this.request<unknown>(`/machines/${encodeURIComponent(id)}`, 'GET') }
    catch (error) {
      if (error instanceof FlyMachinesError && error.status === 404) return
      throw error
    }
    throw new FlyMachinesError('Machine cleanup is not yet confirmed; reservation retained.')
  }

  private async request<T>(path: string, method: string, body?: unknown, retries = this.retries): Promise<T> {
    if (!enabled(this.options)) throw new FlyMachinesError('Fly Machines is not configured.')
    const url = `${this.baseUrl}/apps/${encodeURIComponent(this.options.appName)}${path}`
    let lastError: FlyMachinesError | undefined
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeoutMs)
        try {
          const response = await this.fetchImpl(url, {
            method,
            redirect: 'error',
            signal: controller.signal,
            headers: { Authorization: `Bearer ${this.options.apiToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
          })
          if (!response.ok) {
            const header = response.headers.get('retry-after')
            const seconds = header === null ? NaN : Number(header)
            const delay = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : NaN
            throw new FlyMachinesError(`Fly Machines request failed (${response.status}).`, response.status,
              Number.isFinite(delay) ? Math.max(0, Math.min(10_000, delay)) : undefined)
          }
          const text = await response.text()
          if (!text) return undefined as T
          return JSON.parse(text) as T
        } finally {
          clearTimeout(timer)
        }
      } catch (error) {
        lastError = error instanceof FlyMachinesError ? error : new FlyMachinesError('Fly Machines request failed.')
        if (attempt === retries || !retryable(lastError.status)) throw lastError
        await this.sleep(Math.max(lastError.retryAfterMs ?? 0, Math.min(1_000, 100 * 2 ** attempt)))
      }
    }
    throw lastError ?? new FlyMachinesError('Fly Machines request failed.')
  }
}
