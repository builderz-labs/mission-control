import { afterEach, describe, expect, it, vi } from 'vitest'

describe('local model provider discovery', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('discovers Ollama and OpenAI-compatible local models', async () => {
    process.env.SUPAGATE_BASE_URL = 'http://127.0.0.1:8080/v1'
    process.env.LMSTUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'
    process.env.OMLX_BASE_URL = 'http://127.0.0.1:9000/v1'
    process.env.OMLX_API_KEY = 'test-key'

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen2.5-coder:14b', size: 42 }] }),
        }
      }

      return {
        ok: true,
        json: async () => ({ data: [{ id: url.includes('9000') ? 'MLX-Qwen' : 'local-model' }] }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { discoverLocalModels } = await import('@/lib/local-model-providers')
    const models = await discoverLocalModels()

    expect(models.map((model) => model.name)).toEqual(expect.arrayContaining([
      'ollama/qwen2.5-coder:14b',
      'supagate/local-model',
      'lmstudio/local-model',
      'omlx/MLX-Qwen',
    ]))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    )
  })

  it('keeps working when local providers are offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { discoverLocalModels } = await import('@/lib/local-model-providers')

    await expect(discoverLocalModels()).resolves.toEqual([])
  })
})
