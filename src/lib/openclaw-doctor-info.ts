export function isInformationalDoctorLine(line: string): boolean {
  return /^personal codex cli assets found/i.test(line) ||
    /^to review or promote them:/i.test(line) ||
    /^system browser profile cookie import is /i.test(line) ||
    /^importable chrome-family profile cookie databases found/i.test(line) ||
    /^doctor does not access the macos keychain/i.test(line) ||
    /^oauth dir not present \(.*\)\. skipping create/i.test(line) ||
    /^disable unused skills:/i.test(line) ||
    /^inspect details:/i.test(line) ||
    /^memory search is explicitly disabled/i.test(line) ||
    /^tip: back up the agent workspace/i.test(line) ||
    /^no command owner is configured/i.test(line) ||
    /^prefer gateway\.controlui\.github\.token/i.test(line) ||
    /^service argv:/i.test(line) ||
    /^disabled; enable the desktop lab/i.test(line) ||
    /^skill precedence collision:/i.test(line) ||
    /^\d+ allowed skill is not usable/i.test(line) ||
    /^session-logs\b/i.test(line) ||
    /^fix:\s/i.test(line) ||
    /^fix \(pick one\):/i.test(line) ||
    /^set openai_api_key/i.test(line)
}

export function isDoctorTitleLine(line: string): boolean {
  return /^(doctor (info|warnings?|complete)|gateway heap|command owner|host desktop|github projects|browser|memory search|workspace|skills)\b/i.test(line)
}

export function stripDoctorGutter(line: string): string {
  return line
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^[\s│┃║┆┊╎╏]+/, '')
    .replace(/[\s│┃║┆┊╎╏]+$/, '')
    .trim()
}
