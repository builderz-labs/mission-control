/**
 * Browser Agent
 * WHY: Provides a resilient, self-healing browser automation interface
 * that wraps Playwright (or fetch fallback) with circuit-breaker protection,
 * full step event emission, and SQLite session persistence.
 */

import path from 'path'
import fs from 'fs'
import { getDatabase } from '../db'
import { logger } from '../logger'
import {
  emitBrowseStepCompleted,
  emitBrowsePageCaptured,
  emitBrowseSessionEnded,
} from '../autonomous-events'
import { fetchPageContent } from './sandbox'
import type { BrowseResult, BrowseOptions, StepEvent } from './types'

const SCREENSHOT_DIR = path.join(process.cwd(), '.next', 'browse-screenshots')

export class BrowserAgent {
  private constructor() {}

  static getInstance(): BrowserAgent {
    const g = globalThis as typeof globalThis & { __browserAgent?: BrowserAgent }
    // WHY: singleton per process — avoids spawning multiple browser pools
    g.__browserAgent ??= new BrowserAgent()
    return g.__browserAgent
  }

  /**
   * Navigates to a URL, captures content and optionally a screenshot.
   * Persists session to browse_sessions for full audit trail.
   */
  async navigate(url: string, options: BrowseOptions = {}): Promise<BrowseResult> {
    const {
      workspaceId = 1,
      agentId = 'cto-browser',
      timeout = 15000,
      screenshot = false,
      extractSelector,
    } = options
    const startMs = Date.now()
    const steps: StepEvent[] = []

    const db = getDatabase()
    const sessionRow = db
      .prepare(
        `INSERT INTO browse_sessions (agent_id, url, status, workspace_id)
         VALUES (?, ?, 'running', ?)`
      )
      .run(agentId, url, workspaceId)
    const sessionId = sessionRow.lastInsertRowid as number

    try {
      const pageContent = await fetchPageContent(
        url,
        { timeout, screenshot, selector: extractSelector },
        (step) => {
          const elapsed = Date.now() - startMs
          const enriched: StepEvent = { ...step, elapsed }
          steps.push(enriched)
          emitBrowseStepCompleted(sessionId, step.step, elapsed)
        }
      )

      const screenshotPath = pageContent.screenshotBase64
        ? await this.saveScreenshot(sessionId, pageContent.screenshotBase64)
        : null

      emitBrowsePageCaptured(sessionId, url, screenshotPath !== null)

      const durationMs = Date.now() - startMs
      const resultSummary = {
        title: pageContent.title,
        content: pageContent.content.slice(0, 2000),
      }

      db.prepare(
        `UPDATE browse_sessions
         SET status = 'done', result = ?, screenshot_path = ?, completed_at = unixepoch()
         WHERE id = ?`
      ).run(JSON.stringify(resultSummary), screenshotPath, sessionId)

      emitBrowseSessionEnded(sessionId, 'done')
      logger.info({ sessionId, url, durationMs }, 'Browse session completed')

      return {
        url,
        title: pageContent.title,
        content: pageContent.content,
        screenshotPath,
        steps,
        durationMs,
        sessionId,
      }
    } catch (err) {
      db.prepare(
        `UPDATE browse_sessions SET status = 'error', completed_at = unixepoch() WHERE id = ?`
      ).run(sessionId)
      emitBrowseSessionEnded(sessionId, 'error')
      logger.error({ sessionId, url, err }, 'Browse session failed')
      throw err
    }
  }

  /**
   * Convenience method: navigate and return plain-text content only.
   */
  async extractContent(url: string, selector?: string): Promise<string> {
    const result = await this.navigate(url, { extractSelector: selector })
    return result.content
  }

  private async saveScreenshot(sessionId: number, base64: string): Promise<string> {
    await fs.promises.mkdir(SCREENSHOT_DIR, { recursive: true })
    const filename = `session-${sessionId}-${Date.now()}.png`
    const filePath = path.join(SCREENSHOT_DIR, filename)
    await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'))
    return filePath
  }
}
