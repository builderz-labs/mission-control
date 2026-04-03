import { describe, it, expect } from 'vitest'
import { getModelByAlias, getModelByName, getAllModels } from '../models'

describe('getAllModels', () => {
  it('has entries', () => {
    const models = getAllModels()
    expect(models.length).toBeGreaterThan(0)
  })

  it('each model has required fields', () => {
    for (const model of getAllModels()) {
      expect(model.alias).toBeTruthy()
      expect(model.name).toBeTruthy()
      expect(model.provider).toBeTruthy()
      expect(model.description).toBeTruthy()
      expect(typeof model.costPer1kInput).toBe('number')
      expect(model.costPer1kInput).toBeGreaterThanOrEqual(0)
      expect(typeof model.costPer1kOutput).toBe('number')
      expect(model.costPer1kOutput).toBeGreaterThanOrEqual(0)
      expect(typeof model.maxContextTokens).toBe('number')
      expect(model.maxContextTokens).toBeGreaterThan(0)
    }
  })

  it('has unique aliases', () => {
    const models = getAllModels()
    const aliases = models.map(m => m.alias)
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  it('returns same reference (frozen array)', () => {
    expect(getAllModels()).toBe(getAllModels())
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

  it('finds haiku model with low cost', () => {
    const model = getModelByAlias('haiku')
    expect(model).not.toBeUndefined()
    expect(model!.costPer1kInput).toBeLessThan(1)
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
