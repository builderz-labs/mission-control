import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  WEBHOOK_RETRY_LEASE_SECONDS,
  claimDueWebhookRetry,
  releaseWebhookRetryClaim,
} from '@/lib/webhook-retry-lease'

function openRetryDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE webhooks (
      id INTEGER PRIMARY KEY,
      name TEXT, url TEXT, secret TEXT, events TEXT,
      enabled INTEGER, consecutive_failures INTEGER, workspace_id INTEGER
    );
    CREATE TABLE webhook_deliveries (
      id INTEGER PRIMARY KEY,
      webhook_id INTEGER, event_type TEXT, payload TEXT, attempt INTEGER,
      next_retry_at INTEGER, workspace_id INTEGER
    );
    INSERT INTO webhooks VALUES (1, 'hook', 'https://example.com', NULL, '["*"]', 1, 0, 7);
    INSERT INTO webhook_deliveries VALUES (10, 1, 'activity.created', '{}', 0, 100, 7);
    INSERT INTO webhook_deliveries VALUES (11, 1, 'activity.created', '{}', 0, 100, 7);
  `)
  return db
}

describe('claimDueWebhookRetry', () => {
  it('leases one due row and leaves the rest eligible', () => {
    const db = openRetryDb()
    const claimed = claimDueWebhookRetry(db, 100)
    expect(claimed?.id).toBe(10)
    expect(claimed?.leaseUntil).toBe(100 + WEBHOOK_RETRY_LEASE_SECONDS)
    expect(db.prepare('SELECT next_retry_at FROM webhook_deliveries WHERE id = 10').get()).toEqual({
      next_retry_at: 100 + WEBHOOK_RETRY_LEASE_SECONDS,
    })
    expect(db.prepare('SELECT next_retry_at FROM webhook_deliveries WHERE id = 11').get()).toEqual({
      next_retry_at: 100,
    })
    const second = claimDueWebhookRetry(db, 100)
    expect(second?.id).toBe(11)
    db.close()
  })

  it('restores a finished claim without dropping later retries', () => {
    const db = openRetryDb()
    const claimed = claimDueWebhookRetry(db, 100)
    expect(claimed).not.toBeNull()
    releaseWebhookRetryClaim(db, claimed!)
    expect(db.prepare('SELECT next_retry_at FROM webhook_deliveries WHERE id = 10').get()).toEqual({
      next_retry_at: null,
    })
    expect(db.prepare('SELECT next_retry_at FROM webhook_deliveries WHERE id = 11').get()).toEqual({
      next_retry_at: 100,
    })
    db.close()
  })
})
