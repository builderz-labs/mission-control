import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function removeDeadLock(lockDir: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(join(lockDir, 'owner'), 'utf8').trim(), 10)
    if (processIsAlive(pid)) return false
    rmSync(lockDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function acquireFileLockSync(targetPath: string): () => void {
  const lockDir = `${targetPath}.mc-lock`

  try {
    mkdirSync(lockDir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !removeDeadLock(lockDir)) {
      const busy = new Error(`Configuration file is busy: ${targetPath}`) as NodeJS.ErrnoException
      busy.code = 'EBUSY'
      throw busy
    }
    mkdirSync(lockDir, { mode: 0o700 })
  }

  const ownerPath = join(lockDir, 'owner')
  let descriptor: number | undefined
  try {
    descriptor = openSync(ownerPath, 'wx', 0o600)
    writeFileSync(descriptor, `${process.pid}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // Preserve the acquisition error.
      }
    }
    rmSync(lockDir, { recursive: true, force: true })
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    rmSync(lockDir, { recursive: true, force: true })
  }
}

export function atomicReplaceFileSync(
  targetPath: string,
  content: string,
  mode = 0o600,
): void {
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let descriptor: number | undefined

  try {
    descriptor = openSync(tempPath, 'wx', mode)
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(tempPath, targetPath)
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // Best effort; the original error is more useful.
      }
    }
    try {
      unlinkSync(tempPath)
    } catch {
      // Successful rename removes the temporary path.
    }
  }
}
