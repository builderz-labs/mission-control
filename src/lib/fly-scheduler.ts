type Result = { ok: boolean; message: string; timestamp: number }
type Task = { running: boolean; nextRun: number; intervalMs: number; lastRun: number | null; lastResult?: Result }

/** A slow scan or local dispatch must never starve remote result collection. */
export function startFlyReconcileLoop(task: Task, run: () => Promise<Omit<Result, 'timestamp'>>) {
  const timer = setInterval(async () => {
    if (task.running) return
    task.running = true
    try { task.lastResult = { ...await run(), timestamp: Date.now() } }
    catch { task.lastResult = { ok: false, message: 'Fly reconciliation unavailable; ownership retained', timestamp: Date.now() } }
    finally {
      task.running = false
      task.lastRun = Date.now()
      task.nextRun = task.lastRun + task.intervalMs
    }
  }, task.intervalMs)
  timer.unref?.()
  return timer
}
