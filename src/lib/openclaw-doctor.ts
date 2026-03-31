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

function stripCommandFailureEnvelope(rawOutput: string): string {
  const trimmed = rawOutput.trim()
  if (!trimmed) return trimmed

  let stripped = trimmed
  if (/doctor complete\./i.test(stripped)) {
    stripped = stripped.replace(/\n*Command failed \(openclaw doctor\):[\s\S]*$/i, '').trim()
  }

  return stripped
}

function isSessionAgingLine(line: string): boolean {
  return /^agent:[\w:-]+ \(\d+[mh] ago\)$/i.test(line)
}

function isPositiveOrInstructionalLine(line: string): boolean {
  return /^no .* warnings? detected/i.test(line) ||
    /^no issues/i.test(line) ||
    /^run(?::|\s+")/i.test(line) ||
    /^all .* (healthy|ok|valid|passed)/i.test(line)
}

function isDecorativeLine(line: string): boolean {
  return /^[▄█▀░\s]+$/.test(line) || /openclaw doctor/i.test(line) || /🦞\s*openclaw\s*🦞/i.test(line)
}

function isStateDirectoryListLine(line: string): boolean {
  return /^(?:\$OPENCLAW_HOME(?:\/\.openclaw)?|~\/\.openclaw|\/\S+)$/.test(line)
}

function isInformationalSectionHeading(line: string): boolean {
  return /^◇\s+(other gateway-like services detected|cleanup hints)\b/i.test(line)
}

function isGatewayServiceInfoLine(line: string): boolean {
  const normalized = line.replace(/^[-*]\s+/, '').trim()
  return /^ai\.openclaw\.[\w-]+\s+\(user,\s+plist:/i.test(normalized)
}

function isCleanupHintLine(line: string): boolean {
  const normalized = line.replace(/^[-*]\s+/, '').trim()
  return /^launchctl bootout gui\/\$UID\/ai\.openclaw\./i.test(normalized) ||
    /^rm ~\/Library\/LaunchAgents\/ai\.openclaw\./i.test(normalized)
}

function isAdvisoryIssueLine(line: string): boolean {
  const normalized = line.replace(/^[-*]\s+/, '').trim()
  return /^channels\.telegram: telegram is in first-time setup mode\./i.test(normalized) ||
    /^found \d+ session lock file/i.test(normalized) ||
    /^~\/\.openclaw\/agents\/main\/sessions\/.+\.jsonl\.lock\b/i.test(normalized) ||
    /^gateway service embeds openclaw_gateway_token and should be$/i.test(normalized) ||
    /^gateway service embeds openclaw_gateway_token and should be reinstalled\./i.test(normalized) ||
    /^found \d+ orphan transcript (?:files?|\w+\(s\)) in$/i.test(normalized) ||
    /^found \d+ orphan transcript (?:files?|\w+\(s\)) in (?:~\/\.openclaw|\$OPENCLAW_HOME(?:\/\.openclaw)?|\/Users\/[^/]+\/\.openclaw)\/agents\/main\/sessions\.?$/i.test(normalized) ||
    /^chrome mcp existing-session is configured for profile\(s\):/i.test(normalized) ||
    /^chrome path:/i.test(normalized) ||
    /^detected chrome /i.test(normalized) ||
    /^enable remote debugging in the browser inspect page/i.test(normalized) ||
    /^keep the browser running and accept the attach consent prompt/i.test(normalized) ||
    /^warn [a-z0-9-]+: loaded without install\/load-path\b/i.test(normalized) ||
    /^set openai_api_key, gemini_api_key, google_api_key, voyage_api_key,$/i.test(normalized) ||
    /^set openai_api_key, gemini_api_key, google_api_key, voyage_api_key, or$/i.test(normalized) ||
    /^set openai_api_key, gemini_api_key, voyage_api_key, or\b/i.test(normalized) ||
    /^configure credentials: openclaw configure --section model/i.test(normalized) ||
    /^for local embeddings:/i.test(normalized) ||
    /^\[plugins\]\s+[a-z0-9-]+: loaded without install\/load-path provenance/i.test(normalized) ||
    /^\[plugins\]\s+[a-z0-9-]+: registered \/codex and \/ccx/i.test(normalized) ||
    /^\[skills\]\s+skipping skill path that resolves outside its configured root\./i.test(normalized)
}

function isMemoryGuidanceLine(line: string): boolean {
  const normalized = line.replace(/^[-*]\s+/, '').trim()
  return /^memory search is enabled, but no embedding provider is ready\./i.test(normalized) ||
    /^semantic recall needs at least one embedding provider\./i.test(normalized) ||
    /^gateway memory probe for default agent is not ready:/i.test(normalized) ||
    /^no api key found for provider "(openai|google|voyage|mistral)"/i.test(normalized) ||
    /^fix \(pick one\):/i.test(normalized) ||
    /^to disable:\s+/i.test(normalized) ||
    /^verify: openclaw memory status --deep/i.test(normalized)
}

function isNonIssueInformationalLine(line: string): boolean {
  return isInformationalSectionHeading(line) ||
    isGatewayServiceInfoLine(line) ||
    isCleanupHintLine(line) ||
    isAdvisoryIssueLine(line) ||
    isMemoryGuidanceLine(line)
}

function isBlockingErrorLine(line: string): boolean {
  const normalized = line.replace(/^[-*]\s+/, '').trim()
  if (!normalized) return false
  if (isDecorativeLine(normalized) || isPositiveOrInstructionalLine(normalized) || isSessionAgingLine(normalized)) {
    return false
  }
  if (isStateDirectoryListLine(normalized) || isNonIssueInformationalLine(normalized)) {
    return false
  }
  if (/^errors?:\s*0+$/i.test(normalized)) return false
  if (/^errors?:\s*[1-9]\d*$/i.test(normalized)) return true
  return /^command failed\b/i.test(normalized) ||
    /^failed\b/i.test(normalized) ||
    /^error\b/i.test(normalized) ||
    /invalid config|config invalid|unrecognized key|fatal\b/i.test(normalized)
}

function isAutoFixableIssueLine(line: string): boolean {
  const normalized = line.replace(/^[-*]\s+/, '').trim()
  return /orphan transcript|multiple state directories|session store dir missing|oauth dir missing|unrecognized key|stale plugin reference|plugin not found|plugins\.allow|interpreter\/runtime/i.test(normalized)
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

export function parseOpenClawDoctorOutput(
  rawOutput: string,
  exitCode = 0,
  options: { stateDir?: string } = {}
): OpenClawDoctorStatus {
  const raw = stripForeignStateDirectoryWarning(stripCommandFailureEnvelope(rawOutput.trim()), options.stateDir).trim()
  const lines = raw
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)
  const meaningfulLines = lines.filter(line => !isNonIssueInformationalLine(line))

  const issues = lines
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(line =>
      !isSessionAgingLine(line) &&
      !isStateDirectoryListLine(line) &&
      !isPositiveOrInstructionalLine(line) &&
      !isGatewayServiceInfoLine(line) &&
      !isCleanupHintLine(line) &&
      !isAdvisoryIssueLine(line) &&
      !isMemoryGuidanceLine(line)
    )
    .filter((line, index, all) => all.indexOf(line) === index)

  const mentionsHealthy = /\bok\b|\bhealthy\b|\bno issues\b|\bno\b.*\bwarnings?\s+detected\b|\bvalid\b/i.test(raw)
  const mentionsCritical = /\bcritical:/i.test(raw)
  const hasDoctorCompletion = /doctor complete\./i.test(raw)
  const hasBlockingError = lines.some(isBlockingErrorLine)
  const advisoryOnly = issues.length === 0 &&
    !mentionsCritical &&
    !/invalid config|config invalid|unrecognized key|session store dir missing|oauth dir missing/i.test(raw)

  let level: OpenClawDoctorLevel = 'healthy'
  if (advisoryOnly && hasDoctorCompletion) {
    level = 'healthy'
  } else if (exitCode !== 0 || mentionsCritical || hasBlockingError) {
    level = 'error'
  } else if (issues.length > 0) {
    level = 'warning'
  }

  const category = detectCategory(raw, issues)

  const summary =
    level === 'healthy'
      ? 'OpenClaw doctor reports no blocking issues under current operating profile.'
      : issues[0] ||
        lines.find(line =>
          !/^run:/i.test(line) &&
          !/^file:/i.test(line) &&
          !/^◇\s+/i.test(line) &&
          !isSessionAgingLine(line) &&
          !isDecorativeLine(line) &&
          !isNonIssueInformationalLine(line)
        ) ||
        'OpenClaw doctor reported configuration issues.'

  const mentionsFixInstruction = /openclaw doctor --fix/i.test(raw)
  const canFix = level !== 'healthy' && (mentionsFixInstruction || issues.some(isAutoFixableIssueLine))

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
