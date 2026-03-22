import path from 'node:path'

export type OpenClawDoctorLevel = 'healthy' | 'warning' | 'error'
export type OpenClawDoctorCategory = 'config' | 'state' | 'security' | 'general'

export interface OpenClawDoctorStatus {
  level: OpenClawDoctorLevel
  category: OpenClawDoctorCategory
  healthy: boolean
  summary: string
  issues: string[]
  canFix: boolean
  raw: string
}

function normalizeLine(line: string): string {
  return line
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^[\s│┃║┆┊╎╏]+/, '')
    .replace(/[\s│┃║┆┊╎╏]+$/, '')
    .trim()
}

function isSessionAgingLine(line: string): boolean {
  return /^agent:\S+ \(\d+[smhd] ago\)$/i.test(line)
}

function isPositiveOrInstructionalLine(line: string): boolean {
  return /^no .* warnings? detected/i.test(line) ||
    /^no issues/i.test(line) ||
    /^run:\s/i.test(line) ||
    /^run\s+["']?openclaw doctor --fix/i.test(line) ||
    /^all .* (healthy|ok|valid|passed)/i.test(line)
}

function isDecorativeLine(line: string): boolean {
  return /^[▄█▀░\s]+$/.test(line) || /openclaw doctor/i.test(line) || /🦞\s*openclaw\s*🦞/i.test(line)
}

function isPathOnlyLine(line: string): boolean {
  return /^(?:\$OPENCLAW_HOME(?:\/\S+)?|~\/\.openclaw(?:\/\S+)?|\/\S+)$/.test(line)
}

function isHintCommandLine(line: string): boolean {
  return /^(?:systemctl|rm\s+|launchctl|schtasks|openclaw\s+(?:pairing|doctor|security|sessions)\b)/i.test(line)
}

function isInformationalIssueLine(line: string): boolean {
  return /^note:/i.test(line) ||
    isHintCommandLine(line) ||
    /^mission-control\.service\b/i.test(line) ||
    /^[\w-]+\s+dms:\s+locked\b/i.test(line)
}

function hasOnlyActiveNonStaleSessionLocks(raw: string): boolean {
  if (!/session locks/i.test(raw)) return false
  if (/stale=yes|\(dead\)|pid=missing/i.test(raw)) return false
  return /stale=no/i.test(raw) || /\(alive\)/i.test(raw)
}

function normalizeFsPath(candidate: string): string {
  return path.resolve(candidate.trim())
}

function normalizeDisplayedPath(candidate: string, stateDir: string): string {
  const trimmed = candidate.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~/.openclaw') return stateDir
  if (trimmed === '$OPENCLAW_HOME' || trimmed === '$OPENCLAW_HOME/.openclaw') return stateDir
  return trimmed
}

function stripForeignStateDirectoryWarning(rawOutput: string, stateDir?: string): string {
  if (!stateDir) return rawOutput

  const normalizedStateDir = normalizeFsPath(stateDir)
  const lines = rawOutput.split(/\r?\n/)
  const kept: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const normalized = normalizeLine(line)

    if (!/multiple state directories detected/i.test(normalized)) {
      kept.push(line)
      continue
    }

    const blockLines = [line]
    let cursor = index + 1
    while (cursor < lines.length) {
      const nextLine = lines[cursor] ?? ''
      const nextNormalized = normalizeLine(nextLine)
      if (!nextNormalized) {
        blockLines.push(nextLine)
        cursor += 1
        continue
      }
      if (/^(active state dir:|[-*]\s+(?:\/|~\/|\$OPENCLAW_HOME)|\|)/i.test(nextNormalized)) {
        blockLines.push(nextLine)
        cursor += 1
        continue
      }
      break
    }

    const listedDirs = blockLines
      .map(normalizeLine)
      .filter(entry => /^[-*]\s+/.test(entry))
      .map(entry => entry.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean)
      .map(entry => normalizeDisplayedPath(entry, normalizedStateDir))

    const foreignDirs = listedDirs.filter(entry => normalizeFsPath(entry) !== normalizedStateDir)
    const onlyForeignDirs = foreignDirs.length > 0

    if (!onlyForeignDirs) {
      kept.push(...blockLines)
    }

    index = cursor - 1
  }

  return kept.join('\n')
}

function detectCategory(raw: string, issues: string[]): OpenClawDoctorCategory {
  if (issues.length === 0) return 'general'

  const rawHaystack = raw.toLowerCase()
  const issuesHaystack = issues.join('\n').toLowerCase()
  const hasSecuritySection = /(?:^|\n).*(?:◇|\?)\s*security\b/i.test(raw)

  if (/invalid config|config invalid|unrecognized key|invalid option/.test(`${issuesHaystack}\n${rawHaystack}`)) {
    return 'config'
  }

  if (/state integrity|orphan transcript|multiple state directories|session history|session locks?|lock file/.test(`${issuesHaystack}\n${rawHaystack}`)) {
    return 'state'
  }

  if (/no auth configured|\bdms?:\s+open\b|pairing code|approval forwarding|channel\s+".*?"/i.test(issues.join('\n')) || (hasSecuritySection && issues.length > 0)) {
    return 'security'
  }

  return 'general'
}

function hasHardError(raw: string): boolean {
  return /invalid config|config invalid|\bfailed\b|\berror:\b|\bexception\b/i.test(raw) || /\berrors?:\s*[1-9]\d*\b/i.test(raw)
}

export function parseOpenClawDoctorOutput(
  rawOutput: string,
  exitCode = 0,
  options: { stateDir?: string } = {}
): OpenClawDoctorStatus {
  const raw = stripForeignStateDirectoryWarning(rawOutput.trim(), options.stateDir).trim()
  const lines = raw
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)

  let issues = lines
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(line =>
      !isSessionAgingLine(line) &&
      !isPathOnlyLine(line) &&
      !isPositiveOrInstructionalLine(line) &&
      !isInformationalIssueLine(line)
    )

  if (hasOnlyActiveNonStaleSessionLocks(raw)) {
    issues = issues.filter(line => !/^Found \d+ session lock file/.test(line))
  }

  // Strip positive/negated phrases before checking for warning keywords
  const rawForWarningCheck = raw
    .replace(/\bno\s+\w+\s+(?:security\s+)?warnings?\s+detected\b/gi, '')
    .replace(/^run\s+["']?openclaw doctor --fix.*$/gim, '')
  const mentionsWarnings = /\bwarning|warnings|problem|problems|invalid config\b/i.test(rawForWarningCheck)

  let level: OpenClawDoctorLevel = 'healthy'
  if (exitCode !== 0 || hasHardError(raw)) {
    level = 'error'
  } else if (issues.length > 0 || mentionsWarnings) {
    level = 'warning'
  }

  const category = detectCategory(raw, issues)

  const summary =
    level === 'healthy'
      ? 'OpenClaw doctor reports a healthy configuration.'
      : issues[0] ||
        lines.find(line =>
          !/^run:/i.test(line) &&
          !/^file:/i.test(line) &&
          !isSessionAgingLine(line) &&
          !isDecorativeLine(line)
        ) ||
        'OpenClaw doctor reported configuration issues.'

  const canFix = level !== 'healthy'

  return {
    level,
    category,
    healthy: level === 'healthy',
    summary,
    issues,
    canFix,
    raw,
  }
}
