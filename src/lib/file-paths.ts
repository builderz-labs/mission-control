export interface DetectedFilePath {
  path: string
  start: number
  end: number
  displayName: string
  extension: string
}

const PATH_REGEX =
  /(?<![a-zA-Z])(?:~\/|\.\/|\/(?:Users|home|tmp|var|etc|opt|usr|mnt|media|srv|proc|sys|dev|run|boot|lib|bin|sbin|snap)\/)[^\s]*/g

const URL_PREFIX = /^(?:https?|ftp):\/\//i

const TRAILING_PUNCTUATION = /[.,;:!?)]+$/

export function detectFilePaths(text: string): DetectedFilePath[] {
  const results: DetectedFilePath[] = []

  for (const match of text.matchAll(PATH_REGEX)) {
    let path = match[0]
    const start = match.index!

    // Skip if preceded by :// (URL)
    const before = text.slice(Math.max(0, start - 10), start)
    if (/[:\/]\/$/.test(before)) continue
    if (URL_PREFIX.test(text.slice(Math.max(0, start - 8), start + path.length))) continue

    // Strip trailing punctuation that's not part of the path
    const trailingMatch = path.match(TRAILING_PUNCTUATION)
    if (trailingMatch) {
      path = path.slice(0, -trailingMatch[0].length)
    }

    // Skip empty or root-only paths
    if (path === '~/' || path === './' || path.length <= 2) continue

    const end = start + path.length
    const lastSlash = path.lastIndexOf('/')
    const displayName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
    const dotIndex = displayName.lastIndexOf('.')
    const extension =
      dotIndex > 0
        ? displayName.slice(dotIndex)
        : dotIndex === 0
          ? displayName
          : ''

    results.push({ path, start, end, displayName, extension })
  }

  return results
}
