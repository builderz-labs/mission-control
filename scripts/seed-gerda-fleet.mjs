#!/usr/bin/env node
// Seed Gerda's 13-agent fleet into Mission Control.
// Reads API key from .data/.auto-generated. Idempotent: skips agents that already exist.

import { readFileSync } from 'node:fs';

const env = readFileSync('.data/.auto-generated', 'utf8');
const apiKey = env.match(/API_KEY=(\S+)/)[1];
const BASE = process.env.MC_URL || 'http://127.0.0.1:3000';

const fleet = [
  {
    name: 'sofia',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Email PA. Reads 6 Gmail inboxes, triages, drafts replies, applies labels. TypeScript on VPS under PM2 at /opt/sofia/. Triggers: hello@ 4x/day, ops@ every 10 min.',
    config: {
      description: 'Email PA — TypeScript agent on VPS, runs under PM2',
      location: '~/sofia/',
      runtime: 'pm2',
      verb: 'triage',
    },
  },
  {
    name: 'james',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Finance / P&L per property. Python + Claude Agent SDK. Owns Revolut bridge, cancellation refunds, monthly compare, Stripe checks. Writes to "James - Validation" sheet only.',
    config: {
      description: 'Finance / P&L per property',
      location: '~/james/',
      runtime: 'python',
      verb: 'reconcile',
    },
  },
  {
    name: 'leo',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Marketing intelligence + GEO monitoring. Tracks brand mentions, AI search citations (ChatGPT/Perplexity/Gemini), competitor moves, content shipped. Friday weekly scans.',
    config: {
      description: 'Marketing intelligence + GEO monitoring',
      location: '~/leo/',
      runtime: 'python',
      verb: 'monitor',
    },
  },
  {
    name: 'victoria',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Revenue generation. Direct bookings, in-stay extensions, dormant lead mining. Mark-paid + pipeline writer. Weekly strategy scan Mondays 09:00 BST.',
    config: {
      description: 'Revenue generation — direct bookings, extensions',
      location: '~/victoria/',
      runtime: 'python',
      verb: 'convert',
    },
  },
  {
    name: 'aria',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Pricing. ADR, occupancy, PriceLabs comparison. v3.5.3 formula locked. Reads BOOM + PriceLabs + comp scraper. Phase 2: auto-write to PriceLabs after 4-week shadow.',
    config: {
      description: 'Pricing — ADR, occ, PriceLabs',
      location: '~/aria/',
      runtime: 'python',
      verb: 'price',
    },
  },
  {
    name: 'marcus',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Compliance. Contracts, certs, legal docs. T&Cs drafting, ICO/UKALA/PRS/TPO renewals, PDF template generation, e-signature via DocuSeal.',
    config: {
      description: 'Compliance — contracts, certs, legal docs',
      location: '~/marcus/',
      runtime: 'python',
      verb: 'verify',
    },
  },
  {
    name: 'atlas',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Chief of Staff / orchestrator. Coordinates all agents, enforces hand-offs, owns Supabase writes, runs daily brief. Slack bot @atlas with do <task> spawning Claude Code SDK sessions.',
    config: {
      description: 'Chief of Staff / orchestrator',
      location: '~/atlas/',
      runtime: 'python',
      verb: 'orchestrate',
    },
  },
  {
    name: 'edward',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Meta-layer systems architect. Scans everywhere, proposes improvements to #agent-reports. Friday formal scans. Owns drift detection + new-agent proposals.',
    config: {
      description: 'Meta-layer systems architect',
      location: '~/edward/',
      runtime: 'python',
      verb: 'scan',
    },
  },
  {
    name: 'cleo',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Cash Flow Guardian. Daily cash position, 14-day forecast, landlord standing-order health, arrears flagging. Runs morning briefs.',
    config: {
      description: 'Cash Flow Guardian',
      location: '~/cleo/',
      runtime: 'python',
      verb: 'forecast',
    },
  },
  {
    name: 'iris',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Property QA & Guest Experience. Owns guest-experience queue, routes signals to ops, reads review streams, triages complaints from cleaners + maintenance via comms-bridge.',
    config: {
      description: 'Property QA & Guest Experience',
      location: '~/iris/',
      runtime: 'python',
      verb: 'triage',
    },
  },
  {
    name: 'larry',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Landlord Relations Guardian. Retention, check-ins, contract renewals. Flags rent/contract mentions in WA + email. Drafts landlord comms.',
    config: {
      description: 'Landlord Relations Guardian',
      location: '~/larry/',
      runtime: 'python',
      verb: 'retain',
    },
  },
  {
    name: 'nina',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Onboarding. 50-task playbook per new flat: BOOM setup, OTA listings, photos, utilities, certs, keys, cleaning rota. Owns onboarding template per property.',
    config: {
      description: 'Onboarding — 50-task playbook per new flat',
      location: '~/nina/',
      runtime: 'python',
      verb: 'onboard',
    },
  },
  {
    name: 'nathan',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Deal analysis. SA rent-to-rent shortlists, GO/REVIEW/NO GO verdicts. Real-numbers deck for ICS/HRS portfolio scenarios. Works inside ~/iris/rfp_response/.',
    config: {
      description: 'Deal analysis — SA rent-to-rent shortlists',
      location: '~/iris/rfp_response/',
      runtime: 'python',
      verb: 'score',
    },
  },
  {
    name: 'hugo',
    role: 'agent',
    status: 'offline',
    soul_content:
      'Maintenance Dispatcher (proposed, not yet built). One verb: dispatch. Reads BOOM service tickets + cleaner reports via comms-bridge → assigns trusted contractor via WhatsApp. Depends on comms-bridge being live.',
    config: {
      description: 'Maintenance Dispatcher — proposed agent',
      location: 'TBC',
      runtime: 'python',
      verb: 'dispatch',
      status_note: 'PROPOSED — see project_edward_scan_15may.md §C',
    },
  },
];

async function fetchExisting() {
  const res = await fetch(`${BASE}/api/agents`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const json = await res.json();
  return new Set((json.agents || []).map((a) => a.name.toLowerCase()));
}

async function createAgent(agent) {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(agent),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 200) };
}

const existing = await fetchExisting();
console.log(`Found ${existing.size} existing agents in Mission Control`);

let created = 0;
let skipped = 0;
for (const agent of fleet) {
  if (existing.has(agent.name.toLowerCase())) {
    console.log(`⏭  ${agent.name} — already exists, skipping`);
    skipped++;
    continue;
  }
  const r = await createAgent(agent);
  if (r.ok) {
    console.log(`✓  ${agent.name} — created`);
    created++;
  } else {
    console.log(`✗  ${agent.name} — failed: ${r.status} ${r.body}`);
  }
}

console.log(`\nDone. Created ${created}, skipped ${skipped}, total fleet now ${existing.size + created}.`);
