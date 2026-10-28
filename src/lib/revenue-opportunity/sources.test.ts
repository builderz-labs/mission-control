import { describe, expect, it } from 'vitest'
import { detectPainTerms, normalizeGithubIssue, normalizeHnHit, selectScanQueries } from './sources'

describe('opportunity scanner sources', () => {
  it('keeps a 50/30/20-ish diversified query batch', () => {
    const q = selectScanQueries(2, 6)
    expect(q).toHaveLength(6)
    expect(q.filter((x) => x.portfolio_bucket === 'HIGH_ECONOMIC_GRAVITY')).toHaveLength(3)
    expect(q.filter((x) => x.portfolio_bucket === 'ADJACENT')).toHaveLength(2)
    expect(q.filter((x) => x.portfolio_bucket === 'EXPLORATION')).toHaveLength(1)
  })

  it('detects explicit pain language', () => {
    expect(detectPainTerms('This manual spreadsheet copy paste process is frustrating and error-prone')).toEqual(
      expect.arrayContaining(['manual','copy-paste','spreadsheet','frustrating','error-prone'])
    )
  })

  it('normalizes source records without inventing economic claims', () => {
    const query = selectScanQueries(0, 1)[0]
    const hn = normalizeHnHit({ objectID:'1', title:'Manual workflow', created_at_i:100 }, query)
    const gh = normalizeGithubIssue({ id:2, title:'Slow manual process', body:'tedious', html_url:'https://github.com/x/y/issues/1' }, query)
    expect(hn?.raw_payload).toHaveProperty('workflow_hint')
    expect(gh?.pain_terms.length).toBeGreaterThan(0)
    expect(JSON.stringify(gh)).not.toContain('willingness_to_pay')
  })
})
