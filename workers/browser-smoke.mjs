import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'package.json'))
let chromium
try { ({ chromium } = require('playwright')) }
catch { ({ chromium } = require('@playwright/test')) }
const browser = await chromium.launch({ headless: true, timeout: 30_000 })
try {
  const page = await browser.newPage()
  await page.setContent('<h1>Mission Control browser ready</h1>', { timeout: 10_000 })
  if (await page.textContent('h1') !== 'Mission Control browser ready') throw new Error('Chromium render mismatch')
  console.log('Chromium launch and render passed')
} finally {
  await browser.close()
}
