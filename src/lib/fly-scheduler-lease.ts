import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

/** Renew independently of slow network batches; never release another owner's lease. */
export function acquireFlySchedulerLease(db: Database.Database) {
  const owner = randomUUID()
  const acquired = db.prepare('UPDATE fly_scheduler_lock SET owner=?,expires_at=unixepoch()+120 WHERE id=1 AND expires_at<=unixepoch()').run(owner)
  if (!acquired.changes) return null
  let lost = false
  const renew = () => {
    try {
      if (!db.prepare('UPDATE fly_scheduler_lock SET expires_at=unixepoch()+120 WHERE id=1 AND owner=? AND expires_at>unixepoch()').run(owner).changes) lost = true
    } catch { lost = true }
  }
  const timer = setInterval(renew, 30_000)
  timer.unref?.()
  return {
    assertOwned() {
      if (lost || !db.prepare('SELECT 1 FROM fly_scheduler_lock WHERE id=1 AND owner=? AND expires_at>unixepoch()').get(owner)) {
        throw new Error('Fly scheduler lease lost; admission stopped')
      }
    },
    release() {
      clearInterval(timer)
      db.prepare('UPDATE fly_scheduler_lock SET owner=NULL,expires_at=0 WHERE id=1 AND owner=?').run(owner)
    },
  }
}
