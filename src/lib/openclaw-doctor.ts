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
  return line.replace(/\u001b\[[0-9;]*m/g, '').trim()
}

function isSessionAgingLine(line: string): boolean {
  return /^agent:[\w:-]+ \(\d+[mh] ago\)$/i.test(line)
}

function detectCategory(raw: string, issues: string[]): OpenClawDoctorCategory {
  const haystack = `${raw}\n${issues.join('\n')}`.toLowerCase()

  if (/invalid config|config invalid|unrecognized key|invalid option/.test(haystack)) {
    return 'config'
  }

  if (/state integrity|orphan transcript|multiple state directories|session history/.test(haystack)) {
    return 'state'
  }

  if (/security audit|channel security|security /.test(haystack)) {
    return 'security'
  }

  return 'general'
}

export function parseOpenClawDoctorOutput(rawOutput: string, exitCode = 0): OpenClawDoctorStatus {
  const raw = rawOutput.trim()
  const lines = raw
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)

  const issues = lines
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(line => !isSessionAgingLine(line))

  const mentionsWarnings = /\bwarning|warnings|problem|problems|invalid config|fix\b/i.test(raw)
  const mentionsHealthy = /\bok\b|\bhealthy\b|\bno issues\b|\bvalid\b/i.test(raw)

  let level: OpenClawDoctorLevel = 'healthy'
  if (exitCode !== 0 || /invalid config|failed|error/i.test(raw)) {
    level = 'error'
  } else if (issues.length > 0 || mentionsWarnings) {
    level = 'warning'
  } else if (!mentionsHealthy && lines.length > 0) {
    level = 'warning'
  }

  const category = detectCategory(raw, issues)

  const summary =
    level === 'healthy'
      ? 'OpenClaw doctor reports a healthy configuration.'
      : issues[0] ||
        lines.find(line => !/^run:/i.test(line) && !/^file:/i.test(line) && !isSessionAgingLine(line)) ||
        'OpenClaw doctor reported configuration issues.'

  const canFix = level !== 'healthy' || /openclaw doctor --fix/i.test(raw)

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
