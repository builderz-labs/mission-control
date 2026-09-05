export type MiniMaxRegion = 'global_en' | 'cn_zh'
export type MiniMaxProtocol = 'openai' | 'anthropic'

export interface MiniMaxEnvironment {
  MINIMAX_API_KEY?: string
  MINIMAX_REGION?: string
  MINIMAX_API_PROTOCOL?: string
}

export const MINIMAX_REGIONS = {
  global_en: {
    openaiBaseUrl: 'https://api.minimax.io/v1',
    anthropicBaseUrl: 'https://api.minimax.io/anthropic',
    docsRoot: 'https://platform.minimax.io/docs',
  },
  cn_zh: {
    openaiBaseUrl: 'https://api.minimaxi.com/v1',
    anthropicBaseUrl: 'https://api.minimaxi.com/anthropic',
    docsRoot: 'https://platform.minimaxi.com/docs',
  },
} as const

export function getMiniMaxApiKey(env: MiniMaxEnvironment = process.env as MiniMaxEnvironment): string | null {
  return (env.MINIMAX_API_KEY || '').trim() || null
}

export function resolveMiniMaxEndpoint(env: MiniMaxEnvironment = process.env as MiniMaxEnvironment): {
  region: MiniMaxRegion
  protocol: MiniMaxProtocol
  baseUrl: string
  docsRoot: string
} {
  const region = (env.MINIMAX_REGION || 'global_en').trim().toLowerCase()
  if (region !== 'global_en' && region !== 'cn_zh') {
    throw new Error('MINIMAX_REGION must be global_en or cn_zh')
  }

  const protocol = (env.MINIMAX_API_PROTOCOL || 'openai').trim().toLowerCase()
  if (protocol !== 'openai' && protocol !== 'anthropic') {
    throw new Error('MINIMAX_API_PROTOCOL must be openai or anthropic')
  }

  const regionalConfig = MINIMAX_REGIONS[region]
  return {
    region,
    protocol,
    baseUrl: protocol === 'anthropic' ? regionalConfig.anthropicBaseUrl : regionalConfig.openaiBaseUrl,
    docsRoot: regionalConfig.docsRoot,
  }
}
