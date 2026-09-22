import type Database from 'better-sqlite3'
import { getJevCloudConfiguration, deliverJevCloudEvent, JevCloudError } from '@/lib/jev-cloud-transport'
import { getJevCloudQueueStatus, prepareJevCloudPayload, type JevCloudEvent } from '@/lib/jev-cloud-repository'

type Db = Database.Database
const running = new WeakSet<Db>()
const timers = new WeakMap<Db, ReturnType<typeof setInterval>>()

export function getJevCloudStatus(workspaceId: number, db: Db) {
  const queue = getJevCloudQueueStatus(workspaceId, db)
  try {
    const configured = Boolean(getJevCloudConfiguration())
    return { ...queue, configured, project: 'Webdev', state: !configured ? 'local_only'
      : queue.errorCode ? 'retrying' : queue.pending ? 'pending' : queue.synced ? 'synced' : 'ready' }
  } catch {
    return { ...queue, configured: false, project: 'Webdev', state: 'configuration_error',
      errorCode: 'JEV_CLOUD_CONFIGURATION_INVALID' }
  }
}

export async function syncJevCloudOutbox(db: Db, request: typeof fetch = fetch): Promise<void> {
  if (running.has(db)) return
  running.add(db)
  try {
    const configuration = getJevCloudConfiguration()
    if (!configuration) return
    const events = db.prepare(`SELECT * FROM jev_cloud_outbox WHERE synced_at IS NULL
      AND next_attempt_at<=unixepoch() ORDER BY sequence LIMIT 50`).all() as JevCloudEvent[]
    for (const event of events) {
      try {
        const payload = prepareJevCloudPayload(event, db)
        db.prepare('UPDATE jev_cloud_outbox SET attempts=attempts+1 WHERE event_id=?').run(event.event_id)
        await deliverJevCloudEvent(configuration, payload, request)
        db.prepare('UPDATE jev_cloud_outbox SET synced_at=unixepoch(),error_code=NULL WHERE event_id=?')
          .run(event.event_id)
      } catch (error) {
        const code = error instanceof JevCloudError ? error.code : 'JEV_CLOUD_SYNC_FAILED'
        const delay = Math.min(300, 2 ** Math.min(event.attempts + 1, 8) * 5)
        db.prepare('UPDATE jev_cloud_outbox SET error_code=?,next_attempt_at=unixepoch()+? WHERE event_id=?')
          .run(code, delay, event.event_id)
        break
      }
    }
  } finally { running.delete(db) }
}

export function startJevCloudSync(db: Db): void {
  if (timers.has(db)) return
  const tick = () => { void syncJevCloudOutbox(db).catch(() => { /* status exposes safe configuration errors */ }) }
  const timer = setInterval(tick, 5_000)
  timer.unref?.()
  timers.set(db, timer)
  tick()
}

export function stopJevCloudSync(db: Db): void {
  const timer = timers.get(db)
  if (timer) clearInterval(timer)
  timers.delete(db)
}
