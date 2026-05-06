import { describe, test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import bot from '../../../scripts/passive-income-bot.cjs'
import memoryApi from '../../../scripts/memory-api.cjs'

// All unit tests use _dry_run: true to avoid writing to the live SQLite database.
// CLI tests use spawnSync to exercise the real CLI path (--dry-run skips DB there too).
// Evidence-write integration test uses the live local DB (same pattern as
// memory-service-tests.test.ts which already calls memoryApi.health() / status()
// against the live DB). The test is guarded: it skips if the DB is inaccessible.

const VALID_NICHE = 'printable appliance repair service call checklist'
const VAGUE_NICHE = 'stuff'
const SOFTWARE_NICHE = 'saas app for developers'

describe('passive-income-bot', () => {
  // ── Acceptance criteria from spec ──────────────────────────────────────────

  test('valid niche returns DRAFT_CREATED or WATCH', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    expect(['DRAFT_CREATED', 'WATCH', 'REJECTED']).toContain(result.status)
    // appliance checklist should score well enough for DRAFT_CREATED
    expect(result.status).toBe('DRAFT_CREATED')
  })

  test('missing niche returns validation error', () => {
    const result = bot.run({ niche: '', _dry_run: true })
    expect(result.error).toBeDefined()
    expect(result.status).toBe(400)
  })

  test('undefined niche returns validation error', () => {
    const result = bot.run({ _dry_run: true } as any)
    expect(result.error).toBeDefined()
    expect(result.status).toBe(400)
  })

  test('output label is DRAFT — NOT APPROVED', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    expect(result.label).toBe('DRAFT — NOT APPROVED')
  })

  test('risk_level is 1', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    expect(result.risk_level).toBe(1)
  })

  // ── Brief structure ─────────────────────────────────────────────────────────

  test('brief contains all 9 required score fields', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const scores = result.brief?.scores
    expect(scores).toBeDefined()
    for (const key of bot.CRITERIA) {
      expect(scores[key]).toBeDefined()
      expect(typeof scores[key]).toBe('number')
    }
  })

  test('all score values are between 1 and 10 inclusive', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const scores = result.brief?.scores ?? {}
    for (const val of Object.values(scores) as number[]) {
      expect(val).toBeGreaterThanOrEqual(1)
      expect(val).toBeLessThanOrEqual(10)
    }
  })

  test('brief contains product_idea, buyer, pain_point, recommendation, next_action', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    // Use optional chaining — expect() will catch undefined values if present
    expect(result.brief?.product_idea).toBeTypeOf('string')
    expect(result.brief?.buyer).toBeTypeOf('string')
    expect(result.brief?.pain_point).toBeTypeOf('string')
    expect(result.brief?.recommendation).toBeTypeOf('string')
    expect(result.brief?.next_action).toBeTypeOf('string')
    expect((result.brief?.product_idea ?? '').length).toBeGreaterThan(0)
    expect((result.brief?.recommendation ?? '').length).toBeGreaterThan(0)
  })

  // ── Evidence entry ──────────────────────────────────────────────────────────

  test('dry-run sets evidence_entry_id to "dry-run"', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    expect(result.evidence_entry_id).toBe('dry-run')
  })

  // ── Scoring heuristics ──────────────────────────────────────────────────────

  test('appliance checklist niche scores above DRAFT_THRESHOLD', () => {
    const scores = bot.scoreNiche(VALID_NICHE)
    const total = Object.values(scores).reduce((a: number, b: number) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(bot.DRAFT_THRESHOLD)
  })

  test('vague niche scores below DRAFT_THRESHOLD', () => {
    const scores = bot.scoreNiche(VAGUE_NICHE)
    const total = Object.values(scores).reduce((a: number, b: number) => a + b, 0)
    expect(total).toBeLessThan(bot.DRAFT_THRESHOLD)
  })

  test('vague niche returns WATCH or REJECTED (not DRAFT_CREATED)', () => {
    const result = bot.run({ niche: VAGUE_NICHE, _dry_run: true })
    expect(result.status).not.toBe('DRAFT_CREATED')
    expect(['WATCH', 'REJECTED']).toContain(result.status)
  })

  test('software niche scores lower ease_of_production than PDF niche', () => {
    const softwareScores = bot.scoreNiche(SOFTWARE_NICHE)
    const pdfScores = bot.scoreNiche(VALID_NICHE)
    expect(softwareScores.ease_of_production).toBeLessThan(pdfScores.ease_of_production)
  })

  test('software niche scores lower maintenance_burden (higher burden = lower score) than PDF niche', () => {
    const softwareScores = bot.scoreNiche(SOFTWARE_NICHE)
    const pdfScores = bot.scoreNiche(VALID_NICHE)
    // maintenance_burden is inverted: higher score = lower burden (better)
    expect(softwareScores.maintenance_burden).toBeLessThan(pdfScores.maintenance_burden)
  })

  // ── CRITERIA constant ───────────────────────────────────────────────────────

  test('CRITERIA exports exactly 9 dimensions', () => {
    expect(bot.CRITERIA).toHaveLength(9)
  })

  test('DRAFT_THRESHOLD is greater than WATCH_THRESHOLD', () => {
    expect(bot.DRAFT_THRESHOLD).toBeGreaterThan(bot.WATCH_THRESHOLD)
  })

  // ── Whitespace handling ─────────────────────────────────────────────────────

  test('leading/trailing whitespace in niche is trimmed', () => {
    const withSpaces = bot.run({ niche: '  printable appliance repair service call checklist  ', _dry_run: true })
    const clean = bot.run({ niche: VALID_NICHE, _dry_run: true })
    expect(withSpaces.status).toBe(clean.status)
    expect(withSpaces.label).toBe(clean.label)
  })
})

// ── Evidence signals unit tests ────────────────────────────────────────────────

describe('passive-income-bot evidence signals', () => {
  test('no evidence_signals → evidence_basis is heuristic_only', () => {
    const result = bot.run({ niche: VALID_NICHE, _dry_run: true })
    expect(result.brief?.evidence_basis).toBe('heuristic_only')
    expect(result.brief?.evidence_signals_used).toBeNull()
  })

  test('empty evidence_signals object → evidence_basis is heuristic_only', () => {
    const result = bot.run({ niche: VALID_NICHE, evidence_signals: {}, _dry_run: true })
    expect(result.brief?.evidence_basis).toBe('heuristic_only')
  })

  test('provided evidence_signals → evidence_basis is user_supplied_signals', () => {
    const result = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { competitor_count: 12 },
      _dry_run: true,
    })
    expect(result.brief?.evidence_basis).toBe('user_supplied_signals')
    expect(result.brief?.evidence_signals_used).not.toBeNull()
  })

  test('competitor_count 1–20 increases demand and competition_weakness', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { competitor_count: 12 },
      _dry_run: true,
    })
    const baseDemand = base.brief?.scores?.demand ?? 0
    const baseComp = base.brief?.scores?.competition_weakness ?? 0
    const adjDemand = withSignals.brief?.scores?.demand ?? 0
    const adjComp = withSignals.brief?.scores?.competition_weakness ?? 0
    // +1 each from 1–20 range, clamped at 10
    expect(adjDemand).toBe(Math.min(baseDemand + 1, 10))
    expect(adjComp).toBe(Math.min(baseComp + 1, 10))
  })

  test('competitor_count 0 increases competition_weakness and decreases demand', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { competitor_count: 0 },
      _dry_run: true,
    })
    const baseComp = base.brief?.scores?.competition_weakness ?? 0
    const adjComp = withSignals.brief?.scores?.competition_weakness ?? 0
    const baseDemand = base.brief?.scores?.demand ?? 0
    const adjDemand = withSignals.brief?.scores?.demand ?? 0
    expect(adjComp).toBe(Math.min(baseComp + 2, 10))
    expect(adjDemand).toBe(Math.max(baseDemand - 1, 1))
  })

  test('competitor_count >100 increases demand and decreases competition_weakness', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { competitor_count: 200 },
      _dry_run: true,
    })
    const adjDemand = withSignals.brief?.scores?.demand ?? 0
    const adjComp = withSignals.brief?.scores?.competition_weakness ?? 0
    const baseDemand = base.brief?.scores?.demand ?? 0
    const baseComp = base.brief?.scores?.competition_weakness ?? 0
    expect(adjDemand).toBe(Math.min(baseDemand + 2, 10))
    expect(adjComp).toBe(Math.max(baseComp - 2, 1))
  })

  test('review_complaints increases buyer_pain (each meaningful complaint +1, max 5)', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: {
        review_complaints: ['hard to track service calls', 'no standard form exists'],
      },
      _dry_run: true,
    })
    const basePain = base.brief?.scores?.buyer_pain ?? 0
    const adjPain = withSignals.brief?.scores?.buyer_pain ?? 0
    expect(adjPain).toBe(Math.min(basePain + 2, 10))
  })

  test('review_complaints caps at 5 complaints even if more are provided', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: {
        review_complaints: [
          'complaint one long enough',
          'complaint two long enough',
          'complaint three long enough',
          'complaint four long enough',
          'complaint five long enough',
          'complaint six long enough', // beyond cap
          'complaint seven long enough', // beyond cap
        ],
      },
      _dry_run: true,
    })
    const basePain = base.brief?.scores?.buyer_pain ?? 0
    const adjPain = withSignals.brief?.scores?.buyer_pain ?? 0
    expect(adjPain).toBe(Math.min(basePain + 5, 10))
  })

  test('price_points avg >= 12 adds +2 price_potential', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { price_points: [12, 15, 18] },
      _dry_run: true,
    })
    const basePrice = base.brief?.scores?.price_potential ?? 0
    const adjPrice = withSignals.brief?.scores?.price_potential ?? 0
    expect(adjPrice).toBe(Math.min(basePrice + 2, 10))
  })

  test('price_points avg 5–11 adds +1 price_potential', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { price_points: [5, 9] },
      _dry_run: true,
    })
    const basePrice = base.brief?.scores?.price_potential ?? 0
    const adjPrice = withSignals.brief?.scores?.price_potential ?? 0
    expect(adjPrice).toBe(Math.min(basePrice + 1, 10))
  })

  test('price_points avg < 3 subtracts -1 price_potential', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { price_points: [1, 2] },
      _dry_run: true,
    })
    const basePrice = base.brief?.scores?.price_potential ?? 0
    const adjPrice = withSignals.brief?.scores?.price_potential ?? 0
    expect(adjPrice).toBe(Math.max(basePrice - 1, 1))
  })

  test('search_phrases (up to 5) each add +1 demand', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { search_phrases: ['appliance repair checklist', 'service call form'] },
      _dry_run: true,
    })
    const baseDemand = base.brief?.scores?.demand ?? 0
    const adjDemand = withSignals.brief?.scores?.demand ?? 0
    expect(adjDemand).toBe(Math.min(baseDemand + 2, 10))
  })

  test('notes are included in evidence_signals_used but do not change scores', () => {
    const base = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withNotes = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { notes: ['Saw this requested in r/appliancerepair'] },
      _dry_run: true,
    })
    // Scores must be identical (notes don't score)
    for (const key of bot.CRITERIA) {
      expect(withNotes.brief?.scores?.[key]).toBe(base.brief?.scores?.[key])
    }
    // But evidence_basis flips because notes count as content
    expect(withNotes.brief?.evidence_basis).toBe('user_supplied_signals')
    expect(withNotes.brief?.evidence_signals_used?.notes).toContain('Saw this requested in r/appliancerepair')
  })

  test('evidence_summary changes when signals are provided', () => {
    const heuristic = bot.run({ niche: VALID_NICHE, _dry_run: true })
    const withSignals = bot.run({
      niche: VALID_NICHE,
      evidence_signals: { competitor_count: 5 },
      _dry_run: true,
    })
    expect(heuristic.brief?.evidence_summary).toContain('Heuristic score')
    expect(withSignals.brief?.evidence_summary).toContain('Signal-adjusted score')
  })

  test('all adjusted scores remain within 1–10', () => {
    // Use many signals at once to stress-test clamping
    const result = bot.run({
      niche: VALID_NICHE,
      evidence_signals: {
        competitor_count: 5,
        review_complaints: ['c1 long', 'c2 long', 'c3 long', 'c4 long', 'c5 long'],
        price_points: [20, 25],
        search_phrases: ['s1', 's2', 's3', 's4', 's5'],
        notes: ['some context'],
      },
      _dry_run: true,
    })
    for (const val of Object.values(result.brief?.scores ?? {})) {
      expect(val as number).toBeGreaterThanOrEqual(1)
      expect(val as number).toBeLessThanOrEqual(10)
    }
  })
})

// ── CLI behavior tests ─────────────────────────────────────────────────────────
// These tests spawn the script as a real subprocess to verify argument parsing,
// stdout format, and exit codes — the same user-facing interface described in docs.

const BOT_PATH = path.resolve(__dirname, '../../../scripts/passive-income-bot.cjs')

describe('passive-income-bot CLI', () => {
  test('--dry-run with valid niche exits 0 and emits valid JSON', () => {
    const proc = spawnSync(
      process.execPath,
      [BOT_PATH, '--niche', VALID_NICHE, '--task-id', 'cli-test-001', '--dry-run'],
      { encoding: 'utf8' }
    )
    expect(proc.status).toBe(0)
    expect(proc.stderr).toBe('')
    const parsed = JSON.parse(proc.stdout)
    expect(['DRAFT_CREATED', 'WATCH', 'REJECTED']).toContain(parsed.status)
    expect(parsed.label).toBe('DRAFT — NOT APPROVED')
    expect(parsed.risk_level).toBe(1)
    expect(parsed.evidence_entry_id).toBe('dry-run')
  })

  test('--dry-run with valid niche stdout is parseable JSON with required top-level keys', () => {
    const proc = spawnSync(
      process.execPath,
      [BOT_PATH, '--niche', VALID_NICHE, '--dry-run'],
      { encoding: 'utf8' }
    )
    const parsed = JSON.parse(proc.stdout)
    expect(parsed).toHaveProperty('status')
    expect(parsed).toHaveProperty('risk_level')
    expect(parsed).toHaveProperty('label')
    expect(parsed).toHaveProperty('brief')
    expect(parsed).toHaveProperty('evidence_entry_id')
  })

  test('--dry-run missing --niche exits nonzero and emits error JSON', () => {
    const proc = spawnSync(
      process.execPath,
      [BOT_PATH, '--dry-run'],
      { encoding: 'utf8' }
    )
    expect(proc.status).not.toBe(0)
    const parsed = JSON.parse(proc.stdout)
    expect(parsed).toHaveProperty('error')
    expect(typeof parsed.error).toBe('string')
    expect(parsed.status).toBe(400)
  })

  test('--dry-run with empty --niche value exits nonzero', () => {
    const proc = spawnSync(
      process.execPath,
      [BOT_PATH, '--niche', '', '--dry-run'],
      { encoding: 'utf8' }
    )
    expect(proc.status).not.toBe(0)
    const parsed = JSON.parse(proc.stdout)
    expect(parsed).toHaveProperty('error')
  })

  test('appliance checklist niche returns DRAFT_CREATED via CLI', () => {
    const proc = spawnSync(
      process.execPath,
      [BOT_PATH, '--niche', VALID_NICHE, '--dry-run'],
      { encoding: 'utf8' }
    )
    const parsed = JSON.parse(proc.stdout)
    expect(parsed.status).toBe('DRAFT_CREATED')
  })
})

// ── Evidence write integration test ──────────────────────────────────────────
// Strategy: vi.mock() cannot intercept require() calls made inside a CJS file's
// function bodies at runtime — it only intercepts imports in vitest's ESM resolver.
// Therefore mocking memory-api.cjs from the test level is not reliable here.
//
// Instead, we test against the live local DB (path: .data/mission-control.db),
// which is the same approach used by memory-service-tests.test.ts (it calls
// memoryApi.health() and memoryApi.status() against the live DB).
//
// The test is guarded: if the DB is inaccessible (e.g., in CI without a seeded
// DB), the test is skipped rather than failed. One entry is written per run;
// it appears in the review queue as a low-confidence observation, which is safe.

describe('passive-income-bot evidence write (live DB, guarded)', () => {
  test('non-dry-run returns a numeric string evidence_entry_id when DB is accessible', () => {
    const health = (memoryApi as unknown as { health: () => { ok: boolean } }).health()
    if (!health.ok) {
      console.warn('[SKIP] DB not accessible — skipping evidence write integration test')
      return
    }

    const result = bot.run({ niche: VALID_NICHE, _dry_run: false })

    // Validation errors would mean no DB write was attempted
    if ('error' in result) {
      throw new Error(`Bot returned validation error unexpectedly: ${result.error}`)
    }

    // evidence_entry_id should be a numeric string (DB row id) on success
    expect(result.evidence_entry_id).not.toBeNull()
    expect(result.evidence_entry_id).not.toBe('dry-run')
    expect(typeof result.evidence_entry_id).toBe('string')
    expect(Number.isNaN(Number(result.evidence_entry_id))).toBe(false)
  })
})
