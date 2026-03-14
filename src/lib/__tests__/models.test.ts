import { describe, it, expect } from 'vitest'
import { MODEL_CATALOG, getModelByAlias, getModelByName, getAllModels } from '../models'

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
      expect(typeof model.costPer1k).toBe('number')
      expect(model.costPer1k).toBeGreaterThanOrEqual(0)
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

  it('finds haiku model', () => {
    const model = getModelByAlias('haiku')
    expect(model).not.toBeUndefined()
    expect(model!.costPer1k).toBeLessThan(1)
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
