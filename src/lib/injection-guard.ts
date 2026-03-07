/**
 * Injection Guard — prompt injection and command injection detection for Mission Control.
 *
 * Scans user input destined for AI agents, shell commands, or rendered UI.
 * Provides both a detection function and a Zod refinement for validation schemas.
 *
 * Three protection layers:
 * 1. Prompt injection — catches attempts to override system instructions
 * 2. Command injection — catches shell metacharacters and escape sequences
 * 3. Exfiltration — catches attempts to send data to external endpoints
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InjectionSeverity = 'info' | 'warning' | 'critical'
export type InjectionCategory = 'prompt' | 'command' | 'exfiltration' | 'encoding'

export interface InjectionMatch {
  category: InjectionCategory
  severity: InjectionSeverity
  rule: string
  description: string
  matched: string
}

export interface InjectionReport {
  safe: boolean
  matches: InjectionMatch[]
}

export interface GuardOptions {
  /** Only flag critical-severity matches as unsafe (default: false — warn + critical both trigger) */
  criticalOnly?: boolean
  /** Maximum input length to scan (default: 50_000 chars) */
  maxLength?: number
  /** Scan context: 'prompt' applies all rules; 'display' skips command injection; 'shell' focuses on command rules */
  context?: 'prompt' | 'display' | 'shell'
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface InjectionRule {
  rule: string
  category: InjectionCategory
  severity: InjectionSeverity
  pattern: RegExp
  description: string
  /** Which contexts this rule applies to */
  contexts: Array<'prompt' | 'display' | 'shell'>
}

const RULES: InjectionRule[] = [
  // ── Prompt injection: system override ────────────────────────
  {
    rule: 'prompt-override',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|your|system)\s+(?:instructions?|rules?|guidelines?|prompts?|directives?|constraints?)/i,
    description: 'Attempts to override system instructions',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-new-identity',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:you\s+are\s+now|act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a\s+)?(?:(?:un)?restricted|evil|jailbr(?:o|ea)ken|different|new))\b/i,
    description: 'Attempts to assign a new identity or unrestricted role',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-safety-bypass',
    category: 'prompt',
    severity: 'critical',
    pattern: /\b(?:bypass|disable|turn\s+off|deactivate|circumvent)\s+(?:all\s+)?(?:safety|security|content|moderation|ethic(?:al|s)?)\s*(?:filters?|checks?|guard(?:rail)?s?|rules?|measures?|restrictions?)?\b/i,
    description: 'Attempts to bypass safety measures',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-hidden-instruction',
    category: 'prompt',
    severity: 'critical',
    pattern: /\[(?:SYSTEM|INST|HIDDEN|ADMIN|IMPORTANT)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]\s*.{10,}/i,
    description: 'Hidden system-style instruction markers',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-delimiter-escape',
    category: 'prompt',
    severity: 'warning',
    pattern: /(?:<\/?(?:system|user|assistant|human|ai|instruction|context)>|```\s*system\b|\|>\s*(?:system|admin)\b)/i,
    description: 'Prompt delimiter injection (XML-style role tags or code block system markers)',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'prompt-repeat-leak',
    category: 'prompt',
    severity: 'warning',
    pattern: /\b(?:repeat|recite|echo|output|print|reveal|show|display)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?|initial\s+(?:message|prompt))\b/i,
    description: 'Attempts to extract system prompt',
    contexts: ['prompt'],
  },

  // ── Command injection ───────────────────────────────────────
  {
    rule: 'cmd-shell-metachar',
    category: 'command',
    severity: 'critical',
    pattern: /(?:[;&|`$]\s*(?:rm\b|wget\b|curl\b|nc\b|ncat\b|bash\b|sh\b|python\b|perl\b|ruby\b|php\b|node\b))|(?:\$\(.*(?:rm|wget|curl|nc|bash|sh))/i,
    description: 'Shell metacharacters followed by dangerous commands',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-path-traversal',
    category: 'command',
    severity: 'critical',
    pattern: /(?:\.\.\/){2,}|\.\.\\(?:\.\.\\){1,}/,
    description: 'Path traversal sequences',
    contexts: ['prompt', 'shell', 'display'],
  },
  {
    rule: 'cmd-pipe-download',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:curl|wget)\s+[^\n]*\|\s*(?:bash|sh|zsh|python|perl|ruby|node)\b/i,
    description: 'Download-and-run pattern (piped curl/wget to interpreter)',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-reverse-shell',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:\/dev\/tcp\/|mkfifo|nc\s+-[elp]|ncat\s.*-[elp]|bash\s+-i\s+>&?\s*\/dev\/|python.*socket.*connect)\b/i,
    description: 'Reverse shell patterns',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'cmd-env-access',
    category: 'command',
    severity: 'warning',
    pattern: /\b(?:printenv|env\b.*(?:AUTH_PASS|API_KEY|SECRET|TOKEN)|cat\s+(?:\/proc\/self\/environ|\.env\b|\/etc\/(?:shadow|passwd)))/i,
    description: 'Attempts to access environment variables or sensitive system files',
    contexts: ['prompt', 'shell'],
  },

  // ── Exfiltration ────────────────────────────────────────────
  {
    rule: 'exfil-send-data',
    category: 'exfiltration',
    severity: 'critical',
    pattern: /\b(?:send|post|upload|transmit|exfiltrate|forward)\s+(?:all\s+)?(?:the\s+)?(?:data|files?|contents?|secrets?|keys?|tokens?|credentials?|passwords?|env(?:ironment)?)\s+(?:to|via|using|through)\b/i,
    description: 'Instructions to exfiltrate data',
    contexts: ['prompt', 'display'],
  },
  {
    rule: 'exfil-webhook',
    category: 'exfiltration',
    severity: 'warning',
    pattern: /\b(?:webhook|callback|postback)\s*[:=]\s*https?:\/\/(?!(?:localhost|127\.0\.0\.1))/i,
    description: 'External webhook URL that could be used for data exfiltration',
    contexts: ['prompt', 'shell'],
  },

  // ── Encoding / obfuscation ──────────────────────────────────
  {
    rule: 'enc-base64-run',
    category: 'encoding',
    severity: 'warning',
    pattern: /(?:base64\s+-d|atob\s*\(|Buffer\.from\s*\([^)]+,\s*['"]base64['"])/i,
    description: 'Base64 decode that may hide malicious content',
    contexts: ['prompt', 'shell'],
  },
  {
    rule: 'enc-heavy-hex',
    category: 'encoding',
    severity: 'info',
    pattern: /(?:\\x[0-9a-f]{2}){8,}|(?:\\u[0-9a-f]{4}){6,}/i,
    description: 'Heavy hex/unicode escape sequences that may hide malicious content',
    contexts: ['prompt', 'shell', 'display'],
  },
]

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

/**
 * Scan a string for prompt injection, command injection, and exfiltration patterns.
 *
 * Returns a report with `safe: true` if no actionable matches were found.
 */
export function scanForInjection(input: string, options: GuardOptions = {}): InjectionReport {
  const { criticalOnly = false, maxLength = 50_000, context = 'prompt' } = options

  if (!input || typeof input !== 'string') {
    return { safe: true, matches: [] }
  }

  // Truncate overly long input to prevent ReDoS
  const text = input.length > maxLength ? input.slice(0, maxLength) : input
  const matches: InjectionMatch[] = []

  for (const rule of RULES) {
    if (!rule.contexts.includes(context)) continue

    const match = rule.pattern.exec(text)
    if (match) {
      matches.push({
        category: rule.category,
        severity: rule.severity,
        rule: rule.rule,
        description: rule.description,
        matched: match[0].slice(0, 80),
      })
    }
  }

  const unsafe = matches.some(
    m => m.severity === 'critical' || (!criticalOnly && m.severity === 'warning')
  )

  return { safe: !unsafe, matches }
}

// ---------------------------------------------------------------------------
// Zod refinement helpers
// ---------------------------------------------------------------------------

/** Zod `.refine()` that rejects strings containing prompt/command injection */
export function noInjection(context: GuardOptions['context'] = 'prompt') {
  return (val: string) => {
    const report = scanForInjection(val, { context })
    return report.safe
  }
}

/** Zod `.superRefine()` with detailed error messages per injection match */
export function injectionRefinement(context: GuardOptions['context'] = 'prompt') {
  return (val: string, ctx: z.RefinementCtx) => {
    const report = scanForInjection(val, { context })
    if (!report.safe) {
      for (const m of report.matches) {
        if (m.severity === 'critical' || m.severity === 'warning') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Injection detected [${m.rule}]: ${m.description}`,
          })
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/** Strip shell metacharacters from a string before passing to command args */
export function sanitizeForShell(input: string): string {
  // Remove null bytes and common shell metacharacters
  return input
    .replace(/\0/g, '')
    .replace(/[;&|`$(){}[\]<>!\\]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
}

/** Strip prompt-delimiter-style tags from user input */
export function sanitizeForPrompt(input: string): string {
  return input
    .replace(/<\/?(?:system|user|assistant|human|ai|instruction|context)>/gi, '')
    .replace(/\[(?:SYSTEM|INST|HIDDEN|ADMIN)\s*(?:OVERRIDE|MESSAGE|INSTRUCTION)?[\]:]/gi, '')
}

/** Sanitize content for safe HTML rendering (escapes HTML entities) */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
