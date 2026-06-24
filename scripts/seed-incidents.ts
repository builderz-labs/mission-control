/**
 * Seed realistic property incidents + interventions so the learning loop can be
 * validated end-to-end, then run a learn pass and print the resulting rules.
 *
 *   npx tsx scripts/seed-incidents.ts
 *
 * Idempotent: re-running upserts on (property_id, date, title) and re-derives
 * outcomes. Safe to run against a dev DB. Skips seeding if incidents already
 * exist unless SEED_FORCE=1.
 */
import { getDatabase } from '../src/lib/db'
import { onIncidentCreated, onIncidentResolved, learnRules, getLearningDashboard } from '../src/lib/incident-learning'

const WORKSPACE = 1
const HOUR = 3600
const DAY = 86400

interface Seed {
  property_id: string
  date: string // YYYY-MM-DD (the day it was reported / predicted)
  title: string
  category: string
  severity: string // the TRIAGE call (predicted)
  description?: string
  reported_by?: string
  cost?: number
  cost_vendor?: string
  guest_mentions?: number
  guest_sentiment?: string
  guest_impact_score?: number // realised (Iris)
  resolution_days: number
  validated_by?: string[]
}

// Pimlico water = recurring critical, costly, hurts guests (triaged high, turns critical)
// Hoxton cleaner = triaged medium but actually trivial guest impact (over-predicted)
// Kensington electrical/access = triaged low but high guest impact, fast to fix (under-predicted)
const SEEDS: Seed[] = [
  // --- Pimlico water: 4 recurring incidents ~55-65 days apart ---
  { property_id: 'PIMLICO', date: '2025-12-02', title: 'Bathroom ceiling water ingress', category: 'water', severity: 'high', cost: 620, cost_vendor: 'AquaFix Ltd', guest_mentions: 3, guest_sentiment: 'negative', guest_impact_score: 9, resolution_days: 6, reported_by: 'hugo', validated_by: ['hugo', 'james', 'iris'] },
  { property_id: 'PIMLICO', date: '2026-01-28', title: 'Leak under kitchen sink flooding flat', category: 'water', severity: 'high', cost: 480, cost_vendor: 'AquaFix Ltd', guest_mentions: 4, guest_sentiment: 'negative', guest_impact_score: 8, resolution_days: 5, reported_by: 'hugo', validated_by: ['hugo', 'james', 'iris'] },
  { property_id: 'PIMLICO', date: '2026-03-24', title: 'Recurring damp + water stain master bedroom', category: 'water', severity: 'high', cost: 710, cost_vendor: 'DampPro', guest_mentions: 3, guest_sentiment: 'negative', guest_impact_score: 9, resolution_days: 7, reported_by: 'hugo', validated_by: ['hugo', 'james', 'iris'] },
  { property_id: 'PIMLICO', date: '2026-05-21', title: 'Burst pipe in airing cupboard', category: 'water', severity: 'high', cost: 540, cost_vendor: 'AquaFix Ltd', guest_mentions: 5, guest_sentiment: 'negative', guest_impact_score: 9, resolution_days: 6, reported_by: 'hugo', validated_by: ['hugo', 'james', 'iris'] },

  // --- Hoxton cleaner: 3 incidents, triaged medium, trivial actual guest impact ---
  { property_id: 'HOXTON', date: '2026-02-10', title: 'Cleaner missed turnover checklist', category: 'cleaner', severity: 'medium', cost: 45, cost_vendor: 'SparkleClean', guest_mentions: 1, guest_sentiment: 'neutral', guest_impact_score: 2, resolution_days: 1, reported_by: 'iris', validated_by: ['iris'] },
  { property_id: 'HOXTON', date: '2026-03-18', title: 'Cleaner late arrival', category: 'cleaner', severity: 'medium', cost: 0, guest_mentions: 0, guest_sentiment: 'neutral', guest_impact_score: 1, resolution_days: 1, reported_by: 'iris', validated_by: ['iris'] },
  { property_id: 'HOXTON', date: '2026-04-22', title: 'Linen not replaced after checkout', category: 'cleaner', severity: 'medium', cost: 30, cost_vendor: 'SparkleClean', guest_mentions: 1, guest_sentiment: 'neutral', guest_impact_score: 2, resolution_days: 1, reported_by: 'iris', validated_by: ['iris'] },

  // --- Kensington access: 3 incidents, triaged low, fast to fix but high guest impact ---
  { property_id: 'KENSINGTON', date: '2026-02-05', title: 'Smart lock battery dead, guest locked out', category: 'access', severity: 'low', cost: 60, cost_vendor: 'KeyNinja', guest_mentions: 2, guest_sentiment: 'negative', guest_impact_score: 8, resolution_days: 0, reported_by: 'hugo', validated_by: ['hugo', 'iris'] },
  { property_id: 'KENSINGTON', date: '2026-03-30', title: 'Key safe code not working on arrival', category: 'access', severity: 'low', cost: 0, guest_mentions: 3, guest_sentiment: 'negative', guest_impact_score: 7, resolution_days: 0, reported_by: 'hugo', validated_by: ['hugo', 'iris'] },
  { property_id: 'KENSINGTON', date: '2026-05-12', title: 'Building fob deactivated, guest stuck in lobby', category: 'access', severity: 'low', cost: 0, guest_mentions: 2, guest_sentiment: 'negative', guest_impact_score: 8, resolution_days: 0, reported_by: 'hugo', validated_by: ['hugo', 'iris'] },

  // --- Kensington electrical: 3 incidents, mid severity ---
  { property_id: 'KENSINGTON', date: '2026-01-15', title: 'Consumer unit tripping intermittently', category: 'electrical', severity: 'medium', cost: 220, cost_vendor: 'VoltSafe', guest_mentions: 1, guest_sentiment: 'negative', guest_impact_score: 5, resolution_days: 2, reported_by: 'hugo', validated_by: ['hugo', 'james'] },
  { property_id: 'KENSINGTON', date: '2026-04-08', title: 'Oven + hob dead, no cooking', category: 'electrical', severity: 'medium', cost: 310, cost_vendor: 'VoltSafe', guest_mentions: 2, guest_sentiment: 'negative', guest_impact_score: 6, resolution_days: 3, reported_by: 'hugo', validated_by: ['hugo', 'james'] },
  { property_id: 'KENSINGTON', date: '2026-05-30', title: 'Immersion heater failure, no hot water', category: 'electrical', severity: 'medium', cost: 280, cost_vendor: 'VoltSafe', guest_mentions: 3, guest_sentiment: 'negative', guest_impact_score: 7, resolution_days: 2, reported_by: 'hugo', validated_by: ['hugo', 'james'] },
]

interface Intervention {
  property_id: string
  category: string
  intervention_type: string
  description: string
  success: number
  recurred: number
  resolution_hours: number
  cost?: number
}

const INTERVENTIONS: Intervention[] = [
  // Pimlico water: temp workarounds kept failing; root-cause contractor swap held
  { property_id: 'PIMLICO', category: 'water', intervention_type: 'temp_workaround', description: 'Sealant patch + dehumidifier', success: 0, recurred: 1, resolution_hours: 4, cost: 80 },
  { property_id: 'PIMLICO', category: 'water', intervention_type: 'temp_workaround', description: 'Re-grout + bucket', success: 0, recurred: 1, resolution_hours: 3, cost: 50 },
  { property_id: 'PIMLICO', category: 'water', intervention_type: 'contractor_swap', description: 'Switched to DampPro for full re-pipe of airing cupboard riser', success: 1, recurred: 0, resolution_hours: 48, cost: 710 },
  { property_id: 'PIMLICO', category: 'water', intervention_type: 'landlord_conversation', description: 'Agreed landlord-funded riser replacement to stop recurrence', success: 1, recurred: 0, resolution_hours: 72, cost: 0 },

  // Hoxton cleaner: swapping cleaner fixed it; conversation alone did not
  { property_id: 'HOXTON', category: 'cleaner', intervention_type: 'landlord_conversation', description: 'Warned existing cleaner', success: 0, recurred: 1, resolution_hours: 1, cost: 0 },
  { property_id: 'HOXTON', category: 'cleaner', intervention_type: 'contractor_swap', description: 'Replaced cleaning team', success: 1, recurred: 0, resolution_hours: 24, cost: 0 },

  // Kensington access: preventive maintenance (battery schedule) is the winner
  { property_id: 'KENSINGTON', category: 'access', intervention_type: 'temp_workaround', description: 'Remote unlock for stranded guest', success: 1, recurred: 1, resolution_hours: 0.5, cost: 0 },
  { property_id: 'KENSINGTON', category: 'access', intervention_type: 'preventive_maintenance', description: 'Quarterly smart-lock battery + fob audit schedule', success: 1, recurred: 0, resolution_hours: 2, cost: 60 },
]

function unix(dateStr: string): number {
  return Math.floor(Date.parse(dateStr + 'T10:00:00Z') / 1000)
}

async function main() {
  const db = getDatabase()

  const existing = (db.prepare(`SELECT COUNT(*) c FROM property_incidents WHERE workspace_id = ?`).get(WORKSPACE) as any).c
  if (existing > 0 && process.env.SEED_FORCE !== '1') {
    console.log(`property_incidents already has ${existing} rows — skipping seed (set SEED_FORCE=1 to override).`)
  } else {
    console.log('Seeding incidents...')
    const upsert = db.prepare(`
      INSERT INTO property_incidents
        (property_id, date, title, description, category, severity, status, reported_by,
         resolved_date, cost, cost_vendor, cost_date, guest_mentions, guest_sentiment,
         review_keywords, guest_impact_score, validated_by, created_at, updated_at, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(property_id, date, title, workspace_id) DO UPDATE SET
        category=excluded.category, severity=excluded.severity, status='resolved',
        resolved_date=excluded.resolved_date, cost=excluded.cost, guest_mentions=excluded.guest_mentions,
        guest_impact_score=excluded.guest_impact_score, validated_by=excluded.validated_by,
        updated_at=excluded.updated_at
    `)

    for (const s of SEEDS) {
      const reportedAt = unix(s.date)
      const resolvedAt = reportedAt + s.resolution_days * DAY + 6 * HOUR
      const info = upsert.run(
        s.property_id, s.date, s.title, s.description ?? null, s.category, s.severity, s.reported_by ?? 'hugo',
        resolvedAt, s.cost ?? null, s.cost_vendor ?? null, resolvedAt, s.guest_mentions ?? 0,
        s.guest_sentiment ?? null, null, s.guest_impact_score ?? null,
        JSON.stringify(s.validated_by ?? []), reportedAt, resolvedAt, WORKSPACE,
      )
      const id =
        Number(info.lastInsertRowid) ||
        (db.prepare(`SELECT id FROM property_incidents WHERE property_id=? AND date=? AND title=? AND workspace_id=?`)
          .get(s.property_id, s.date, s.title, WORKSPACE) as any).id
      // Run the loop: capture prediction snapshot, then derive the outcome.
      onIncidentCreated(db, id)
      onIncidentResolved(db, id)
    }

    const intExisting = (db.prepare(`SELECT COUNT(*) c FROM intervention_outcomes WHERE workspace_id = ?`).get(WORKSPACE) as any).c
    if (intExisting === 0) {
      const insInt = db.prepare(`
        INSERT INTO intervention_outcomes
          (property_id, category, intervention_type, description, success, recurred, resolution_hours, cost, created_by, workspace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?)
      `)
      for (const i of INTERVENTIONS) {
        insInt.run(i.property_id, i.category, i.intervention_type, i.description, i.success, i.recurred, i.resolution_hours, i.cost ?? null, WORKSPACE)
      }
      console.log(`Seeded ${INTERVENTIONS.length} interventions.`)
    }
  }

  console.log('\nRunning learn pass...')
  const stats = learnRules(db, WORKSPACE)
  console.log('Learn stats:', stats)

  const dash = getLearningDashboard(db, WORKSPACE)
  console.log('\n=== Summary ===')
  console.log(dash.summary)
  console.log('\n=== Learned rules ===')
  for (const r of dash.rules) {
    console.log(`  [${r.status.toUpperCase()}] ${r.pattern_key}: -> ${r.predicted_severity} (impact ~${r.predicted_impact_score}, conf ${r.confidence}, hits ${r.hits})`)
    console.log(`        ${r.rationale}`)
  }
  console.log('\n=== Prediction accuracy ===')
  for (const a of dash.accuracy) {
    console.log(`  ${a.scope}: ${Math.round(a.accuracy_rate * 100)}% accurate (n=${a.n}, under=${a.under_predicted}, over=${a.over_predicted}, |Δsev|=${a.mean_abs_severity_delta})`)
  }
  console.log('\n=== Intervention effectiveness ===')
  for (const i of dash.interventions) {
    console.log(`  ${i.intervention_type}: ${Math.round(i.success_rate * 100)}% success (${i.successes}/${i.attempts}, recurrences ${i.recurrences})`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
