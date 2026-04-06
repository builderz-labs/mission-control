/**
 * Browser Sandbox
 * WHY: Isolates Playwright imports so the server starts even if Playwright
 * is not installed. Returns mock data in that case, allowing the API to
 * remain functional for testing and dev environments without a browser.
 */

import { logger } from '../logger'
import type { StepEvent } from './types'

export interface PageContent {
  readonly title: string
  readonly content: string
  readonly screenshotBase64: string | null
}

// Cached availability check — avoids repeated require attempts on every call
let _playwrightAvailable: boolean | null = null

async function isPlaywrightAvailable(): Promise<boolean> {
  if (_playwrightAvailable !== null) return _playwrightAvailable
  try {
    // webpackIgnore prevents Turbopack/webpack from bundling optional peer deps.
    // serverExternalPackages in next.config.js handles runtime resolution.
    // @ts-ignore — playwright is an optional peer dep; runtime guards this path
    await import(/* webpackIgnore: true */ 'playwright')
    _playwrightAvailable = true
  } catch {
    _playwrightAvailable = false
    logger.warn('Playwright not available — browser agent running in mock mode')
  }
  return _playwrightAvailable
}

/**
 * Fetches page content using Playwright if available, otherwise falls back to fetch().
 * Emits step events as it progresses so callers can stream progress.
 */
export async function fetchPageContent(
  url: string,
  options: { timeout?: number; selector?: string; screenshot?: boolean },
  onStep: (event: StepEvent) => void
): Promise<PageContent> {
  const available = await isPlaywrightAvailable()
  if (!available) {
    return fetchWithFallback(url, options, onStep)
  }
  return fetchWithPlaywright(url, options, onStep)
}

async function fetchWithPlaywright(
  url: string,
  options: { timeout?: number; selector?: string; screenshot?: boolean },
  onStep: (event: StepEvent) => void
): Promise<PageContent> {
  // @ts-ignore — playwright is an optional peer dep; isPlaywrightAvailable guards this path
  const { chromium } = await import(/* webpackIgnore: true */ 'playwright')
  const { timeout = 15000, selector, screenshot = false } = options

  onStep({ step: 'launch_browser', status: 'running' })
  const browser = await chromium.launch({ headless: true })

  try {
    onStep({ step: 'launch_browser', status: 'done' })
    onStep({ step: 'navigate', status: 'running' })

    const page = await browser.newPage()
    await page.goto(url, { timeout, waitUntil: 'domcontentloaded' })
    onStep({ step: 'navigate', status: 'done' })

    if (selector) {
      onStep({ step: 'wait_selector', status: 'running' })
      await page.waitForSelector(selector, { timeout })
      onStep({ step: 'wait_selector', status: 'done' })
    }

    const title = await page.title()
    const content = selector
      ? (await page.locator(selector).textContent()) ?? ''
      : await page.evaluate(() => document.body.innerText)

    let screenshotBase64: string | null = null
    if (screenshot) {
      onStep({ step: 'screenshot', status: 'running' })
      const buf = await page.screenshot({ type: 'png' })
      screenshotBase64 = buf.toString('base64')
      onStep({ step: 'screenshot', status: 'done' })
    }

    return { title, content, screenshotBase64 }
  } finally {
    await browser.close()
  }
}

async function fetchWithFallback(
  url: string,
  options: { timeout?: number; selector?: string; screenshot?: boolean },
  onStep: (event: StepEvent) => void
): Promise<PageContent> {
  onStep({ step: 'fetch_fallback', status: 'running' })
  // WHY: honour the caller's timeout rather than hardcoding 15 s — browser agent
  // may need a shorter or longer window depending on the target site's SLA
  const response = await fetch(url, { signal: AbortSignal.timeout(options.timeout ?? 15000) })
  const html = await response.text()
  // Strip HTML tags to get readable plain-text content
  const content = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000)
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch?.[1]?.trim() ?? url
  onStep({ step: 'fetch_fallback', status: 'done' })
  return { title, content, screenshotBase64: null }
}
