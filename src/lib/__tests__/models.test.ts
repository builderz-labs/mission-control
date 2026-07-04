import { describe, it, expect } from 'vitest'
import {
  MODEL_CATALOG,
  classifyModelProvider,
  getAllModels,
  getDispatchModelId,
  getModelByAlias,
  getModelByName,
} from '../models'

describe('MODEL_CATALOG', () => {
  it('has entries', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThan(0)
  })

  it('each model has required fields', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.alias).toBeTruthy()
      expect(model.name).toBeTruthy()
      expect(model.provider).toBeTruthy()
      expect(model.description).toBeTruthy()
      expect(typeof model.costPerMTok.input).toBe('number')
      expect(typeof model.costPerMTok.output).toBe('number')
      expect(model.costPerMTok.input).toBeGreaterThanOrEqual(0)
      expect(model.costPerMTok.output).toBeGreaterThanOrEqual(0)
      // Every non-free model charges at least as much for output as input.
      if (model.costPerMTok.input > 0) {
        expect(model.costPerMTok.output).toBeGreaterThanOrEqual(model.costPerMTok.input)
      }
    }
  })

  it('names are provider-prefixed with the provider field', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.name.startsWith(`${model.provider}/`)).toBe(true)
    }
  })

  it('has unique aliases', () => {
    const aliases = MODEL_CATALOG.map(m => m.alias)
    expect(new Set(aliases).size).toBe(aliases.length)
  })
})

describe('getModelByAlias', () => {
  it('finds model by alias', () => {
    const model = getModelByAlias('sonnet')
    expect(model).not.toBeUndefined()
    expect(model!.alias).toBe('sonnet')
    expect(model!.provider).toBe('anthropic')
  })

  it('returns undefined for unknown alias', () => {
    expect(getModelByAlias('nonexistent')).toBeUndefined()
    expect(getModelByAlias('')).toBeUndefined()
  })

  it('finds haiku model and haiku is cheaper than sonnet', () => {
    const haiku = getModelByAlias('haiku')
    const sonnet = getModelByAlias('sonnet')
    expect(haiku).not.toBeUndefined()
    expect(haiku!.costPerMTok.input).toBeLessThan(sonnet!.costPerMTok.input)
    expect(haiku!.costPerMTok.output).toBeLessThan(sonnet!.costPerMTok.output)
  })
})

describe('getModelByName', () => {
  it('finds model by full name', () => {
    const model = getModelByAlias('sonnet')!
    const found = getModelByName(model.name)
    expect(found).not.toBeUndefined()
    expect(found!.alias).toBe('sonnet')
  })

  it('returns undefined for unknown name', () => {
    expect(getModelByName('nonexistent/model')).toBeUndefined()
  })
})

describe('getAllModels', () => {
  it('returns a copy of all models', () => {
    const all = getAllModels()
    expect(all).toHaveLength(MODEL_CATALOG.length)
  })

  it('returns a new array (not same reference)', () => {
    expect(getAllModels()).not.toBe(MODEL_CATALOG)
  })
})

describe('getDispatchModelId', () => {
  it('strips the provider prefix, keeping the exact API model ID', () => {
    expect(getDispatchModelId(getModelByAlias('opus')!)).toBe('claude-opus-4-6')
    expect(getDispatchModelId(getModelByAlias('haiku')!)).toBe('claude-haiku-4-5')
    expect(getDispatchModelId(getModelByAlias('deepseek')!)).toBe('deepseek-r1:14b')
  })
})

describe('classifyModelProvider (catalog-derived classification)', () => {
  it('classifies every catalog entry to its own provider', () => {
    for (const model of MODEL_CATALOG) {
      // Full '<provider>/<modelId>' form
      expect(classifyModelProvider(model.name)).toBe(model.provider)
      // Bare dispatch model ID form (what classifyDirectModel returns)
      expect(classifyModelProvider(getDispatchModelId(model))).toBe(model.provider)
      // Alias form
      expect(classifyModelProvider(model.alias)).toBe(model.provider)
    }
  })

  it('is case- and whitespace-insensitive', () => {
    expect(classifyModelProvider(' Claude-Opus-4-6 ')).toBe('anthropic')
  })

  it('returns undefined for models not in the catalog', () => {
    expect(classifyModelProvider('gpt-5-turbo-9000')).toBeUndefined()
    expect(classifyModelProvider('some/unknown-model')).toBeUndefined()
    expect(classifyModelProvider('')).toBeUndefined()
  })
})
