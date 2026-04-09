/**
 * Skill security scanner — content-level rules to detect prompt injection,
 * shell exploits, data exfiltration, and other malicious patterns.
 */

import type { SecurityReport, SecurityIssue } from './types'

const SECURITY_RULES: Array<{
  rule: string
  pattern: RegExp
  severity: 'info' | 'warning' | 'critical'
  description: string
}> = [
  {
    rule: 'prompt-injection-system',
    pattern: /\b(?:ignore\s+(?:all\s+)?previous\s+instructions?|forget\s+(?:all\s+)?(?:your\s+)?instructions?|you\s+are\s+now\s+(?:a|an)\s+(?:evil|unrestricted))/i,
    severity: 'critical',
    description: 'Potential prompt injection: attempts to override system instructions',
  },
  {
    rule: 'prompt-injection-role',
    pattern: /\b(?:act\s+as\s+(?:a\s+)?(?:root|admin|superuser)|you\s+(?:must|should)\s+(?:always\s+)?execute|bypass\s+(?:all\s+)?safety|disable\s+(?:all\s+)?(?:safety|security|filters?))/i,
    severity: 'critical',
    description: 'Potential prompt injection: role manipulation or safety bypass',
  },
  {
    rule: 'shell-exec-dangerous',
    pattern: /(?:`{3,}\s*(?:bash|sh|zsh|shell)\s*\n[\s\S]*?(?:rm\s+-rf|curl\s+.*\|\s*(?:bash|sh)|wget\s+.*\|\s*(?:bash|sh)|eval\s*\(|exec\s*\())/i,
    severity: 'critical',
    description: 'Executable shell code with dangerous commands (rm -rf, piped curl/wget, eval)',
  },
  {
    rule: 'data-exfiltration',
    pattern: /\b(?:send\s+(?:all\s+)?(?:data|files?|contents?|secrets?|keys?|tokens?)\s+to|exfiltrate|upload\s+(?:all\s+)?(?:data|files?))/i,
    severity: 'critical',
    description: 'Potential data exfiltration instruction',
  },
  {
    rule: 'credential-harvesting',
    pattern: /\b(?:(?:api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"`]?\w{8,})/i,
    severity: 'warning',
    description: 'Possible hardcoded credential or secret in skill content',
  },
  {
    rule: 'obfuscated-content',
    pattern: /(?:(?:atob|btoa|Buffer\.from)\s*\(|\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){5,}|\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){5,})/i,
    severity: 'warning',
    description: 'Potentially obfuscated or encoded content that may hide malicious instructions',
  },
  {
    rule: 'hidden-instructions',
    pattern: /<!--[\s\S]*?(?:ignore|override|bypass|inject|execute)[\s\S]*?-->/i,
    severity: 'warning',
    description: 'HTML comment containing suspicious instructions (may be invisible to users)',
  },
  {
    rule: 'excessive-permissions',
    pattern: /\b(?:sudo|chmod\s+777|chmod\s+\+x\s+\/|chown\s+root)\b/i,
    severity: 'warning',
    description: 'References to elevated permissions or dangerous file permission changes',
  },
  {
    rule: 'network-fetch',
    pattern: /\b(?:fetch|curl|wget|axios|http\.get|request\.get)\s*\(\s*['"`]https?:\/\//i,
    severity: 'info',
    description: 'Skill references external network URLs — verify they are trusted',
  },
  {
    rule: 'path-traversal',
    pattern: /(?:\.\.\/){2,}|(?:\.\.\\){2,}|(?:%2e%2e%2f){2,}/i,
    severity: 'critical',
    description: 'Potential path traversal attack: attempts to access parent directories',
  },
  {
    rule: 'ssrf-internal-network',
    pattern: /\b(?:fetch|curl|wget|axios(?:\.[a-z]+)?|http(?:s?)\.\w+|request(?:\.\w+)?)\s*\(\s*['"`]https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|[^'"` ]*\.internal(?:\/|['"`]))/i,
    severity: 'critical',
    description: 'Potential SSRF: skill attempts to contact localhost or internal/private network addresses',
  },
  {
    rule: 'ssrf-metadata-endpoint',
    pattern: /(?:169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254|instance-data)/i,
    severity: 'critical',
    description: 'Potential SSRF targeting cloud metadata endpoint (AWS/GCP/Azure)',
  },
]

/**
 * Scan SKILL.md content for security issues.
 */
export function checkSkillSecurity(content: string): SecurityReport {
  const issues: SecurityIssue[] = []
  const lines = content.split('\n')

  for (const rule of SECURITY_RULES) {
    const fullMatch = rule.pattern.exec(content)
    if (fullMatch) {
      let lineNum: number | undefined
      const snippet = fullMatch[0].slice(0, 40)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(snippet)) {
          lineNum = i + 1
          break
        }
      }
      issues.push({
        severity: rule.severity,
        rule: rule.rule,
        description: rule.description,
        line: lineNum,
      })
    }
  }

  const hasCritical = issues.some(i => i.severity === 'critical')
  const hasWarning = issues.some(i => i.severity === 'warning')

  return {
    status: hasCritical ? 'rejected' : hasWarning ? 'warning' : 'clean',
    issues,
  }
}
