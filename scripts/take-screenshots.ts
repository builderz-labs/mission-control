import { chromium } from '@playwright/test';
import path from 'path';

const BASE_URL = 'http://localhost:3100';
const USERNAME = 'admin';
const PASSWORD = 'mc-screenshots-2026';
const OUTPUT_DIR = path.join(__dirname, '..', 'docs');

const PANELS: [string, string][] = [
  ['Overview', 'mission-control-overview'],
  ['Agents', 'mission-control-agents'],
  ['Tasks', 'mission-control-tasks'],
  ['Skills', 'mission-control-skills'],
  ['Memory', 'mission-control-memory'],
  ['Cost Tracker', 'mission-control-cost-tracking'],
  ['Security', 'mission-control-security'],
  ['Cron', 'mission-control-cron'],
  ['Activity', 'mission-control-activity'],
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  // Login
  console.log('Logging in...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.fill('#username', USERNAME);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/auth/login'), { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(5000);
  console.log(`  URL: ${page.url()}`);

  // Dismiss onboarding
  for (const text of ['Skip setup', 'Get Started', 'Skip', 'Dismiss', 'Close']) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      console.log(`  Dismissed: "${text}"`);
      await page.waitForTimeout(1500);
    }
  }
  await page.waitForTimeout(2000);

  // Capture each panel using button[title="Label"] selectors
  console.log('Capturing panels...');
  for (const [label, filename] of PANELS) {
    // Nav buttons in collapsed sidebar have title="{label}"
    // Some may be below the fold — scroll them into view first
    const navBtn = page.locator(`button[title="${label}"]`).first();
    try {
      await navBtn.scrollIntoViewIfNeeded({ timeout: 2000 });
      await navBtn.click({ timeout: 2000 });
      await page.waitForTimeout(3000);
      console.log(`  OK: ${filename}.png`);
    } catch {
      // Fallback: try expanded sidebar text or force-evaluate click
      try {
        await page.evaluate((lbl) => {
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            if (btn.getAttribute('title') === lbl || btn.textContent?.trim() === lbl) {
              btn.click();
              return true;
            }
          }
          return false;
        }, label);
        await page.waitForTimeout(3000);
        console.log(`  OK (eval): ${filename}.png`);
      } catch {
        console.log(`  MISS: ${label}`);
      }
    }

    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${filename}.png`),
      fullPage: false,
    });
  }

  await browser.close();
  console.log('Done!');
}

main().catch(console.error);
