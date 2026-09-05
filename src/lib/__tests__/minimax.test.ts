import { describe, expect, it } from 'vitest'
import { getMiniMaxApiKey, MINIMAX_REGIONS, resolveMiniMaxEndpoint } from '@/lib/minimax'

describe('MiniMax endpoint configuration', () => {
  it('defaults to the global OpenAI-compatible endpoint', () => {
    expect(resolveMiniMaxEndpoint({})).toEqual({
      region: 'global_en',
      protocol: 'openai',
      baseUrl: 'https://api.minimax.io/v1',
      docsRoot: 'https://platform.minimax.io/docs',
    })
  })

  it('resolves both China compatibility endpoints', () => {
    expect(resolveMiniMaxEndpoint({ MINIMAX_REGION: 'cn_zh' }).baseUrl)
      .toBe('https://api.minimaxi.com/v1')
    expect(resolveMiniMaxEndpoint({ MINIMAX_REGION: 'cn_zh', MINIMAX_API_PROTOCOL: 'anthropic' }).baseUrl)
      .toBe('https://api.minimaxi.com/anthropic')
  })

  it('resolves the global Anthropic-compatible endpoint', () => {
    expect(resolveMiniMaxEndpoint({ MINIMAX_API_PROTOCOL: 'anthropic' }).baseUrl)
      .toBe('https://api.minimax.io/anthropic')
  })

  it('keeps both regional documentation roots registered', () => {
    expect(MINIMAX_REGIONS.global_en.docsRoot).toBe('https://platform.minimax.io/docs')
    expect(MINIMAX_REGIONS.cn_zh.docsRoot).toBe('https://platform.minimaxi.com/docs')
  })

  it('rejects unsupported regions and protocols', () => {
    expect(() => resolveMiniMaxEndpoint({ MINIMAX_REGION: 'invalid' })).toThrow('MINIMAX_REGION')
    expect(() => resolveMiniMaxEndpoint({ MINIMAX_API_PROTOCOL: 'invalid' })).toThrow('MINIMAX_API_PROTOCOL')
  })

  it('trims the configured API key', () => {
    expect(getMiniMaxApiKey({ MINIMAX_API_KEY: '  configured-key  ' })).toBe('configured-key')
    expect(getMiniMaxApiKey({ MINIMAX_API_KEY: '  ' })).toBeNull()
  })
})
