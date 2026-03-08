#!/usr/bin/env node
const API = 'http://127.0.0.1:3200'
const KEY = 'mc-api-henry-2026-key'

const tasks = [
  // Propel (project_id: 3)
  { title: 'Fix PR #6 merge conflict + PR #3 conflicts', project_id: 3, assigned_to: 'forge', priority: 'high', urgency: 5, due_date: Math.floor(Date.now()/1000), status: 'assigned' },
  { title: 'Propel website launch checklist', project_id: 3, assigned_to: 'henry', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-15').getTime()/1000), status: 'assigned' },
  { title: 'Outreach email templates ready for warmup', project_id: 3, assigned_to: 'quill', priority: 'medium', urgency: 3, due_date: Math.floor(new Date('2026-03-22').getTime()/1000), status: 'assigned' },
  { title: 'Ace outreach engine setup', project_id: 3, assigned_to: 'ace', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-22').getTime()/1000), status: 'assigned' },
  
  // JWF (project_id: 4)
  { title: 'PR #51 hero contrast fix', project_id: 4, assigned_to: 'forge', priority: 'medium', urgency: 3, due_date: Math.floor(new Date('2026-03-10').getTime()/1000), status: 'assigned' },
  { title: 'Visual QA on Warm Editorial redesign', project_id: 4, assigned_to: 'scout', priority: 'medium', urgency: 3, due_date: Math.floor(new Date('2026-03-12').getTime()/1000), status: 'assigned' },
  
  // Conewise/TM Planner (project_id: 1)
  { title: 'Fix map rendering (Leaflet swap)', project_id: 1, assigned_to: 'forge', priority: 'high', urgency: 5, due_date: Math.floor(Date.now()/1000), status: 'in_progress' },
  { title: 'Phase 2 polygon drawing + plan generation', project_id: 1, assigned_to: 'forge', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-15').getTime()/1000), status: 'assigned' },
  { title: 'Conewise name + domain decision', project_id: 1, assigned_to: 'henry', priority: 'low', urgency: 2, status: 'inbox' },
  
  // Atlas (project_id: 2)
  { title: 'Gemini review + merge PRs #40 #41 #42', project_id: 2, assigned_to: 'henry', priority: 'high', urgency: 3, due_date: Math.floor(Date.now()/1000), status: 'assigned' },
  { title: 'Ongoing Atlas backlog improvements', project_id: 2, assigned_to: 'forge', priority: 'low', urgency: 2, status: 'inbox' },
  
  // DeliverReel (project_id: 6)
  { title: 'Convex setup (no Convex yet)', project_id: 6, assigned_to: 'forge', priority: 'high', urgency: 5, due_date: Math.floor(new Date('2026-03-25').getTime()/1000), status: 'assigned' },
  { title: 'Stripe webhooks test', project_id: 6, assigned_to: 'scout', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-25').getTime()/1000), status: 'assigned' },
  { title: 'Launch plan + PH prep (DeliverReel)', project_id: 6, assigned_to: 'quill', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-28').getTime()/1000), status: 'assigned' },
  
  // Tempo (project_id: 1 — use General since no Tempo project)
  { title: 'Stripe integration test (Tempo)', project_id: 1, assigned_to: 'scout', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-25').getTime()/1000), status: 'assigned' },
  { title: 'Launch plan + PH prep (Tempo)', project_id: 1, assigned_to: 'quill', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-28').getTime()/1000), status: 'assigned' },
  
  // Harbour/QuickSite (project_id: 7)
  { title: 'Autonomous website builder spec', project_id: 7, assigned_to: 'sage', priority: 'high', urgency: 3, due_date: Math.floor(new Date('2026-03-10').getTime()/1000), status: 'assigned' },
  { title: 'Build demo quality website example', project_id: 7, assigned_to: 'forge', priority: 'high', urgency: 4, due_date: Math.floor(new Date('2026-03-14').getTime()/1000), status: 'assigned' },
  { title: 'GMB + social content scraper', project_id: 7, assigned_to: 'forge', priority: 'medium', urgency: 3, due_date: Math.floor(new Date('2026-03-21').getTime()/1000), status: 'assigned' },
]

async function seed() {
  for (const task of tasks) {
    try {
      const res = await fetch(`${API}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': KEY },
        body: JSON.stringify(task),
      })
      const data = await res.json()
      if (res.ok) {
        console.log(`✅ Created: ${task.title} (id: ${data.task?.id || data.id})`)
      } else {
        console.log(`❌ Failed: ${task.title} — ${data.error}`)
      }
    } catch (err) {
      console.log(`❌ Error: ${task.title} — ${err.message}`)
    }
  }
}

seed()
