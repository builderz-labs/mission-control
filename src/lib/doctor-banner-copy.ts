export interface DoctorBannerCopy {
  summary: string
  issues: string[]
}

function cleanLine(value: string): string {
  return value
    .replace(/^\s*[-*•]+\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s:;,-]+$/, '')
    .trim()
}

function comparisonKey(value: string): string {
  return cleanLine(value).toLocaleLowerCase()
}

export function prepareDoctorBannerCopy(
  summary: string,
  issues: readonly string[],
): DoctorBannerCopy {
  const cleanSummary = cleanLine(summary)
  const summaryKey = comparisonKey(cleanSummary)
  const seen = new Set<string>()
  const cleanIssues: string[] = []

  for (const rawIssue of issues) {
    const issue = cleanLine(rawIssue)
    const key = comparisonKey(issue)
    if (!issue || key === summaryKey || seen.has(key)) continue
    seen.add(key)
    cleanIssues.push(issue)
  }

  return {
    summary: cleanSummary || 'OpenClaw reported an issue',
    issues: cleanIssues,
  }
}
