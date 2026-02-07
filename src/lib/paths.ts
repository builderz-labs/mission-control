import path from 'node:path'

export function resolveWithin(baseDir: string, relativePath: string): string {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, relativePath)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path escapes base directory')
  }
  return resolved
}
