import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { answerBucket, fingerprintDataset, parseDataset, runItems, savedRows, summarizeQuestion } from './jev-sorter-data'
import { sorterEvaluation, sorterPolicy } from './jev-sorter.fixtures'

afterEach(() => vi.unstubAllGlobals())
describe('sorter data contracts', () => {
  it('validates single text, structured items and bounded datasets', () => {
    expect(parseDataset('hello', 'text')).toEqual(['hello'])
    expect(parseDataset('{"ok":true}', 'json')).toEqual([{ ok: true }])
    expect(parseDataset('["hello",{"ok":true}]', 'dataset')).toHaveLength(2)
    for (const input of ['[]', 'null', 'true', '[null]', '[""]', '{bad', '[1]']) expect(() => parseDataset(input, 'dataset')).toThrow()
    expect(() => parseDataset(JSON.stringify(Array(101).fill('x')), 'dataset')).toThrow(/100/)
    expect(() => parseDataset('x'.repeat(200001), 'text')).toThrow(/200,000/)
    expect(() => parseDataset('['.repeat(32) + '"x"' + ']'.repeat(32), 'json')).toThrow(/nested/)
  })
  it('fingerprints exact server bytes and deduplicates repeated inputs', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const items = await fingerprintDataset(['hello', 'hello', { ok: true }])
    expect(items).toHaveLength(2)
    expect(items[0].hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
  it('never combines other repositories, policies, models, failed runs or old questions', () => {
    const rows = savedRows([
      sorterEvaluation(), sorterEvaluation({ id: 'newest', completed_at: 10 }),
      sorterEvaluation({ id: 'foreign', project_id: 3 }), sorterEvaluation({ policy_id: 9 }),
      sorterEvaluation({ model_requested: 'different' }), sorterEvaluation({ status: 'failed' }),
      sorterEvaluation({ questions: { ready: { type: 'noul', instructions: 'A changed question' } } }),
    ], sorterPolicy)
    expect(rows.map((row) => row.evaluation.id)).toEqual(['newest'])
  })
  it('supports every run scope without turning retries into inflated counts', () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ hash: String(index), state: String(index) }))
    const rows = [{ hash: '0', evaluation: sorterEvaluation() }]
    expect(runItems(items, rows, 'unsorted')).toHaveLength(99)
    expect(runItems(items, rows, '25')).toHaveLength(25)
    expect(runItems(items, rows, '100')).toHaveLength(100)
    expect(runItems(items, rows, 'all')).toHaveLength(100)
  })
  it('uses counts, a local yes threshold, and one-based fractional score averages', () => {
    const rows = [{ hash: 'one', evaluation: sorterEvaluation() }]
    expect(summarizeQuestion(sorterPolicy.questions.ready, 'ready', rows).buckets[0].count).toBe(1)
    expect(summarizeQuestion(sorterPolicy.questions.ready, 'ready', rows, .9).buckets[1].count).toBe(1)
    const summary = summarizeQuestion(sorterPolicy.questions.quality, 'quality', rows)
    expect(summary.average).toBeCloseTo(2.6)
    expect(summary.buckets[2]).toMatchObject({ count: 1, label: '3. Strong' })
    expect(answerBucket({ type: 'score', score: NaN }, sorterPolicy.questions.quality)).toBeNull()
    expect(answerBucket({ type: 'choice', choice: '__proto__' }, sorterPolicy.questions.kind)).toBeNull()
  })
  it('conserves counts and keeps every probability in exactly one binary bucket', () => {
    fc.assert(fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 100 }), (values) => {
      const rows = values.map((value, index) => ({ hash: String(index), evaluation: sorterEvaluation({ answers: { ready: { type: 'noul', noul: value } } }) }))
      const summary = summarizeQuestion(sorterPolicy.questions.ready, 'ready', rows)
      expect(summary.buckets.reduce((total, item) => total + item.count, 0)).toBe(values.length)
    }), { numRuns: 250 })
  })
})
