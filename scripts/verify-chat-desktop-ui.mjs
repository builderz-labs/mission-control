import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const base = 'http://127.0.0.1:3000'
const user = process.env.AUTH_USER || 'admin'
const pass = process.env.AUTH_PASS || ''
const out = '/tmp/mc-chat-desktop-verify.png'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  const login = await page.request.post(`${base}/api/auth/login`, {
    data: { username: user, password: pass },
  })
  if (!login.ok()) throw new Error(`login ${login.status()}`)
  await page.addInitScript(() => sessionStorage.setItem('mc-onboarding-dismissed', '1'))
  await page.goto(`${base}/chat`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.getByText('Projects', { exact: false }).first().waitFor({ timeout: 180000 })
  await page.waitForTimeout(2000)
  const franchise = page.getByText('Franchise readiness agent handoff')
  if (await franchise.count()) {
    await franchise.first().click()
    await page.waitForTimeout(1500)
  } else {
    const folder = page.getByText('stillpoint-builders').first()
    if (await folder.count()) {
      await folder.click()
      await page.waitForTimeout(2000)
      if (await franchise.count()) await franchise.first().click()
    }
  }
  await page.waitForTimeout(1500)
  const handoffBtn = page.getByRole('button', { name: 'Handoff' }).first()
  if (await handoffBtn.count()) await handoffBtn.click()
  await page.waitForTimeout(500)
  const body = await page.locator('body').innerText()
  const checks = {
    desktopTitle: body.includes('Franchise readiness agent handoff'),
    projectChip: body.includes('stillpoint-builders'),
    handoff: /Handoff/i.test(body),
    picker: body.includes('Claude 1') && body.includes('Claude 2') && body.includes('Codex') && body.includes('Grok') && body.includes('Kimi'),
    engineIdFallback: body.includes('Claude e4deed8c-857'),
  }
  await page.screenshot({ path: out, fullPage: false })
  writeFileSync('/tmp/mc-chat-desktop-verify.json', JSON.stringify(checks, null, 2))
  console.log(JSON.stringify({ ...checks, screenshot: out }))
} finally {
  await browser.close()
}
