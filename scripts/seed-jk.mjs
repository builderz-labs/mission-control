/**
 * JK seed script — creates demo clients, brands, approval queue items, KPIs
 * Usage: node scripts/seed-jk.mjs
 *
 * Requires the app to have run at least once (DB + migrations applied).
 */

import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.MISSION_CONTROL_DATA_DIR || join(__dirname, '..', '.data')
const dbPath = join(dataDir, 'mission-control.db')

if (!existsSync(dbPath)) {
  console.error(`DB not found at ${dbPath}. Start the app first to create the database.`)
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const now = Math.floor(Date.now() / 1000)
const monthYear = new Date().toISOString().slice(0, 7) // "YYYY-MM"

// 1. Clients
const clients = [
  { name: 'PT Maju Bersama', slug: 'maju-bersama', contact_name: 'Budi Santoso', contact_email: 'budi@maju.co.id' },
  { name: 'CV Kreasi Digital', slug: 'kreasi-digital', contact_name: 'Siti Rahayu', contact_email: 'siti@kreasi.id' },
]

for (const c of clients) {
  db.prepare(`INSERT OR IGNORE INTO hm_clients (name, slug, contact_name, contact_email, status) VALUES (?, ?, ?, ?, 'active')`)
    .run(c.name, c.slug, c.contact_name, c.contact_email)
}
console.log('✓ Clients seeded')

// 2. Brands
const clientA = db.prepare(`SELECT id FROM hm_clients WHERE slug = 'maju-bersama'`).get()
const clientB = db.prepare(`SELECT id FROM hm_clients WHERE slug = 'kreasi-digital'`).get()

const brands = [
  { client_id: clientA.id, name: 'Brand Kuliner X', slug: 'brand-kuliner-x', category: 'Kuliner', instagram_handle: 'brandkulinerx' },
  { client_id: clientA.id, name: 'Brand Fashion Y', slug: 'brand-fashion-y', category: 'Fashion', instagram_handle: 'brandfashiony' },
  { client_id: clientB.id, name: 'Brand Tech Z', slug: 'brand-tech-z', category: 'Teknologi', instagram_handle: 'brandtechz' },
]

for (const b of brands) {
  db.prepare(`INSERT OR IGNORE INTO hm_brands (client_id, name, slug, category, instagram_handle, status, monthly_workflow_day) VALUES (?, ?, ?, ?, ?, 'active', 1)`)
    .run(b.client_id, b.name, b.slug, b.category, b.instagram_handle)
}
console.log('✓ Brands seeded')

// 3. Brand KPIs
const brandKuliner = db.prepare(`SELECT id FROM hm_brands WHERE slug = 'brand-kuliner-x'`).get()
const brandFashion = db.prepare(`SELECT id FROM hm_brands WHERE slug = 'brand-fashion-y'`).get()
const brandTech = db.prepare(`SELECT id FROM hm_brands WHERE slug = 'brand-tech-z'`).get()

const kpiData = [
  // Brand Kuliner X
  { brand_id: brandKuliner.id, service_type: 'social', kpi_name: 'Instagram ER', target_value: 4.5, target_operator: 'gte', target_unit: '%', current_value: 4.3, status: 'needs_attention' },
  { brand_id: brandKuliner.id, service_type: 'social', kpi_name: 'TikTok avg views growth', target_value: 10, target_operator: 'gte', target_unit: '%/bln', current_value: 86, status: 'on_track' },
  { brand_id: brandKuliner.id, service_type: 'seo', kpi_name: 'Avg Position keyword cluster', target_value: -5, target_operator: 'lte', target_unit: 'pos', current_value: -3.1, status: 'needs_attention' },
  { brand_id: brandKuliner.id, service_type: 'ads', kpi_name: 'ROAS', target_value: 3.0, target_operator: 'gte', target_unit: 'x', current_value: 2.8, status: 'needs_attention' },
  { brand_id: brandKuliner.id, service_type: 'ads', kpi_name: 'CPA', target_value: 50000, target_operator: 'lte', target_unit: 'Rp', current_value: 38700, status: 'on_track' },
  // Brand Fashion Y
  { brand_id: brandFashion.id, service_type: 'social', kpi_name: 'Instagram ER', target_value: 5.0, target_operator: 'gte', target_unit: '%', current_value: 2.1, status: 'off_track' },
  { brand_id: brandFashion.id, service_type: 'ads', kpi_name: 'ROAS', target_value: 3.5, target_operator: 'gte', target_unit: 'x', current_value: 1.8, status: 'off_track' },
  // Brand Tech Z
  { brand_id: brandTech.id, service_type: 'seo', kpi_name: 'Organic Sessions growth', target_value: 20, target_operator: 'gte', target_unit: '%', current_value: 28, status: 'on_track' },
  { brand_id: brandTech.id, service_type: 'social', kpi_name: 'TikTok avg views', target_value: 5000, target_operator: 'gte', target_unit: 'views', current_value: 7200, status: 'on_track' },
]

for (const k of kpiData) {
  db.prepare(`INSERT OR IGNORE INTO hm_brand_kpi (brand_id, service_type, kpi_name, kpi_category, target_value, target_operator, target_unit, current_value, status) VALUES (?, ?, ?, 'lagging', ?, ?, ?, ?, ?)`)
    .run(k.brand_id, k.service_type, k.kpi_name, k.target_value, k.target_operator, k.target_unit, k.current_value, k.status)
}
console.log('✓ KPIs seeded')

// 4. NSM
const nsmData = [
  { brand_id: brandKuliner.id, nsm_name: 'Jumlah leads unik dari semua channel digital per bulan', target_value: 80, current_value: 47, trend_vs_last_period: 34 },
  { brand_id: brandFashion.id, nsm_name: 'Total followers pertumbuhan per bulan', target_value: 1000, current_value: 210, trend_vs_last_period: -5 },
  { brand_id: brandTech.id, nsm_name: 'Demo request dari website per bulan', target_value: 50, current_value: 45, trend_vs_last_period: 12 },
]
for (const n of nsmData) {
  db.prepare(`INSERT OR IGNORE INTO hm_brand_nsm (brand_id, nsm_name, target_value, current_value, trend_vs_last_period) VALUES (?, ?, ?, ?, ?)`)
    .run(n.brand_id, n.nsm_name, n.target_value, n.current_value, n.trend_vs_last_period)
}
console.log('✓ NSM seeded')

// 5. CEPs for Brand Kuliner X
const ceps = [
  { brand_id: brandKuliner.id, cep_name: 'Pre-Lunch Trigger', priority: 'high', when_context: 'Senin-Jumat 11:00-12:00', feeling: 'Lapar + ingin praktis', job_to_be_done: 'Amankan makan tim tanpa keluar kantor', sort_order: 1 },
  { brand_id: brandKuliner.id, cep_name: 'Event Panic', priority: 'medium', when_context: '2-3 minggu sebelum event', feeling: 'Panik, butuh kepastian', job_to_be_done: 'Amankan vendor katering event, budget fix, no drama', sort_order: 2 },
  { brand_id: brandKuliner.id, cep_name: 'Akhir Bulan Budget Tipis', priority: 'low', when_context: 'Akhir bulan', feeling: 'Terbatas budget, cari value', job_to_be_done: 'Makan tim tetap terjaga tanpa boncos', sort_order: 3 },
]
for (const cep of ceps) {
  db.prepare(`INSERT OR IGNORE INTO hm_brand_cep (brand_id, cep_name, priority, when_context, feeling, job_to_be_done, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(cep.brand_id, cep.cep_name, cep.priority, cep.when_context, cep.feeling, cep.job_to_be_done, cep.sort_order)
}
console.log('✓ CEPs seeded')

// 6. Approval queue items (demo — Gate 1 pending for Brand Kuliner X)
const existing = db.prepare(`SELECT id FROM hm_approval_queue WHERE brand_id = ? AND month_year = ? AND gate_number = 1`).get(brandKuliner.id, monthYear)
if (!existing) {
  db.prepare(`
    INSERT INTO hm_approval_queue (brand_id, gate_number, gate_type, service_type, month_year, status, agent_id, summary_text, supporting_data)
    VALUES (?, 1, 'monthly_strategy', 'brand', ?, 'pending', 'GanCMO', ?, ?)
  `).run(
    brandKuliner.id,
    monthYear,
    `Rekomendasi fokus ${monthYear}: Pertahankan momentum TikTok (ER +86% bulan lalu) dan perbaiki 2 KPI yang missed — ROAS Ads dan Instagram ER. Priority layanan: Social > Ads > SEO.`,
    JSON.stringify({
      kpi_recap: { instagram_er: '4.3% (target 4.5%)', tiktok_growth: '+86%', roas: '2.8x (target 3.0x)', cpa: 'Rp38.7rb ✅' },
      recommendation: 'Fokus konten video TikTok format POV untuk Pre-Lunch CEP',
    })
  )
  console.log('✓ Approval queue item (Gate 1) seeded for Brand Kuliner X')
}

// 7. Demo contract
const contractExists = db.prepare(`SELECT id FROM hm_contracts WHERE title = 'SOW Social Media Brand Kuliner X'`).get()
if (!contractExists) {
  db.prepare(`
    INSERT INTO hm_contracts (client_id, brand_id, contract_type, service_type, status, title, contract_number, start_date, end_date, value, billing_cycle)
    VALUES (?, ?, 'sow', 'social', 'active', ?, ?, ?, ?, ?, 'monthly')
  `).run(
    clientA.id, brandKuliner.id,
    'SOW Social Media Brand Kuliner X', 'SOW-003',
    Math.floor(new Date('2026-01-01').getTime() / 1000),
    Math.floor(new Date('2026-06-30').getTime() / 1000),
    2800000
  )
  console.log('✓ Demo contract seeded')
}

console.log('\n✅ JK seed complete!')
console.log(`\nBrand IDs:`)
console.log(`  Brand Kuliner X: ${brandKuliner.id}`)
console.log(`  Brand Fashion Y: ${brandFashion.id}`)
console.log(`  Brand Tech Z: ${brandTech.id}`)
console.log(`\nOpen: http://localhost:3000/portfolio`)
console.log(`Brand session: http://localhost:3000/brands/${brandKuliner.id}`)

db.close()
