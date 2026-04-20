#!/usr/bin/env node
/**
 * Capture screenshots of every DarkMada surface + Atlas page.
 *
 * Prereqs:
 *   - `pnpm dev` running on http://localhost:3000
 *   - You are logged in OR set AUTH bypass for the dev server
 *   - playwright installed: `pnpm dlx playwright install chromium`
 *
 * Usage:
 *   node scripts/capture-darkmada-screenshots.mjs
 *
 * Outputs to docs/darkmada-internal/screenshots/.
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'docs', 'darkmada-internal', 'screenshots')
const BASE = process.env.MC_URL || 'http://localhost:3000'

const PANELS = [
  ['dm-office', 'the-office'],
  ['dm-deck', 'command-deck'],
  ['dm-org', 'org-chart'],
  ['dm-assembly', 'assembly-line'],
  ['dm-vault', 'the-vault'],
  ['dm-library', 'the-library'],
  ['dm-workshop', 'the-workshop'],
  ['dm-forge', 'idea-forge'],
  ['dm-intel', 'intelligence-room'],
]

const ATLAS = [
  ['atlas', 'atlas-overview'],
  ['atlas/system', 'atlas-system'],
  ['atlas/execution', 'atlas-execution'],
  ['atlas/memory', 'atlas-memory'],
  ['atlas/org', 'atlas-org'],
  ['atlas/mcp', 'atlas-mcp'],
  ['atlas/runtime', 'atlas-runtime'],
  ['atlas/compute', 'atlas-compute'],
  ['atlas/network', 'atlas-network'],
  ['atlas/scale', 'atlas-scale'],
  ['atlas/ui-map', 'atlas-ui-map'],
]

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await ctx.newPage()

  for (const [route, name] of [...PANELS, ...ATLAS]) {
    const url = `${BASE}/${route}`
    console.log(`→ ${url}`)
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true })
    } catch (err) {
      console.error(`  failed: ${err.message}`)
    }
  }

  await browser.close()
  console.log(`\nDone. Screenshots in ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
