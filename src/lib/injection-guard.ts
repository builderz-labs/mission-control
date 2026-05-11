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
 *
 * Bypass mitigations (in front of rule matching, fixes #576):
 * - Unicode homoglyph normalization (Cyrillic / Greek / fullwidth → ASCII)
 * - Zero-width and bidi-override character stripping
 * - NFKC compatibility normalization
 * - ROT13 / URL / base64 decoding variants scanned alongside the original
 *
 * The 18 detection rules below are run against both the original input and
 * each normalized/decoded variant. A match in any variant trips the report.
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
  /** Which variant the match came from: 'original' | 'normalized' | 'rot13-decoded' | 'url-decoded' | 'base64-decoded:…' */
  variant?: string
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
  /**
   * Decode and scan additional encoded variants (rot13, url, base64).
   * Default: true. Set to false on hot paths where the decode pass adds
   * latency you can't afford (e.g. per-token streaming filters).
   */
  decodeVariants?: boolean
}

// ---------------------------------------------------------------------------
// Layer 1 — Unicode normalization (defends against issue #576)
// ---------------------------------------------------------------------------

/**
 * Confusables map — single-character homoglyphs that visually mimic ASCII.
 * Sourced from Unicode TR39 confusables.txt (the subset most commonly seen
 * in prompt-injection PoCs). Greek, Cyrillic, fullwidth Latin.
 *
 * Not exhaustive — TR39 has thousands of entries. The set below is curated
 * to cover the documented PoC from issue #576 and the most common bypass
 * vectors seen in published research, without mapping characters that
 * legitimately appear in non-Latin scripts.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic (issue #576 PoC)
  'а': 'a', 'А': 'A',
  'е': 'e', 'Е': 'E',
  'о': 'o', 'О': 'O',
  'р': 'p', 'Р': 'P',
  'с': 'c', 'С': 'C',
  'х': 'x', 'Х': 'X',
  'і': 'i', 'І': 'I',
  'ј': 'j', 'Ј': 'J',
  'ѕ': 's', 'Ѕ': 'S',
  'һ': 'h', 'Һ': 'H',
  'Ү': 'Y', 'ү': 'y',
  // Greek
  'α': 'a', 'Α': 'A',
  'ο': 'o', 'Ο': 'O',
  'ρ': 'p', 'Ρ': 'P',
  'υ': 'u', 'Υ': 'U',
  'χ': 'x', 'Χ': 'X',
  'ε': 'e', 'Ε': 'E',
  'ι': 'i', 'Ι': 'I',
  'κ': 'k', 'Κ': 'K',
  'ν': 'v', 'Ν': 'N',
}

/**
 * Strip zero-width and bidi-override characters that can hide content from
 * regex scanners while still rendering identically to a human.
 *
 * Scope is intentionally narrow:
 * - U+200B / 200C / 200D / FEFF / 2060 — zero-width spaces and joiners
 * - U+202A-U+202E — explicit bidi overrides (LRE/RLE/PDF/LRO/RLO)
 * - U+2066-U+2069 — directional isolates
 * - U+200E / 200F — LTR / RTL marks
 *
 * NOT stripped: U+034F (combining grapheme joiner), U+2061-U+2064 (math
 * invisibles) — those legitimately appear in non-Latin script and math.
 */
export function removeInvisibleChars(input: string): string {
  return input
    // Zero-width spaces, joiners, BOM, word joiner
    .replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, '')
    // LTR / RTL marks
    .replace(/[\u200E\u200F]/g, '')
    // Bidi overrides (LRE/RLE/PDF/LRO/RLO) and directional isolates (LRI/RLI/FSI/PDI)
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    // Null byte (rendered invisibly, can split scanner regexes)
    .replace(/\u0000/g, '')
    // Line/paragraph separators -> real newline so the rule scanner sees them
    .replace(/[\u2028\u2029]/g, '\n')
}

/**
 * Replace homoglyphs with their ASCII equivalents and apply NFKC compatibility
 * normalization. Defensive against the homoglyph attack documented in #576.
 * NFKC also collapses fullwidth Latin (Ａ-Ｚａ-ｚ) to ASCII as a side effect.
 */
export function normalizeConfusables(input: string): string {
  let out = ''
  for (const ch of input) {
    out += CONFUSABLES[ch] ?? ch
  }
  return out.normalize('NFKC')
}

/** Apply zero-width strip + confusables + NFKC. */
export function normalizeForScanning(input: string): string {
  if (!input || typeof input !== 'string') return input
  return normalizeConfusables(removeInvisibleChars(input))
}

// ---------------------------------------------------------------------------
// Encoded-variant decoders
// ---------------------------------------------------------------------------

const ROT13_DANGER_TERMS = [
  'ignore', 'override', 'execute', 'delete', 'remove', 'rm -rf',
  'bypass', 'disable', 'system', 'admin', 'root', 'sudo',
  'jailbreak', 'unrestricted', 'forget', 'disregard',
]

/** Decode a string with ROT13 (letters only). */
export function decodeRot13(input: string): string {
  return input.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0)
    const base = code >= 97 ? 97 : 65
    return String.fromCharCode(((code - base + 13) % 26) + base)
  })
}

/**
 * Heuristic: input might be ROT13-encoded malicious content if its rot13
 * decoding contains a danger term and the original does not.
 */
export function detectRot13(input: string): boolean {
  const lower = input.toLowerCase()
  const decoded = decodeRot13(lower)
  return ROT13_DANGER_TERMS.some(term => decoded.includes(term) && !lower.includes(term))
}

/**
 * Build an array of decoded variants of the input to scan. Each variant
 * has its own length cap to bound CPU on adversarial inputs.
 */
export function generateDecodingVariants(
  input: string,
  maxVariantLength = 50_000,
): Array<{ label: string; text: string }> {
  const variants: Array<{ label: string; text: string }> = []
  const cap = (s: string) => s.length > maxVariantLength ? s.slice(0, maxVariantLength) : s

  if (detectRot13(input)) {
    variants.push({ label: 'rot13-decoded', text: cap(decodeRot13(input)) })
  }

  try {
    const decoded = decodeURIComponent(input)
    if (decoded !== input) variants.push({ label: 'url-decoded', text: cap(decoded) })
  } catch {
    // Invalid URL encoding — skip.
  }

  // Base64: scan for likely candidate substrings (>=24 chars, base64 alphabet).
  // Cap at 5 candidates and require printable-ASCII output to bound CPU.
  const b64Regex = /(?:[A-Za-z0-9+/]{24,}={0,2})/g
  const seen = new Set<string>()
  const base64Matches = input.match(b64Regex) ?? []
  for (const candidate of base64Matches.slice(0, 5)) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    try {
      const decoded = atob(candidate)
      // eslint-disable-next-line no-control-regex
      if (decoded.length >= 4 && !/[\x00-\x08\x0B-\x1F\x7F]/.test(decoded)) {
        variants.push({ label: `base64-decoded:${candidate.slice(0, 12)}…`, text: cap(decoded) })
      }
    } catch {
      // Not valid base64 — skip.
    }
  }

  return variants
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

  // ── SSRF ─────────────────────────────────────────────────────
  {
    rule: 'cmd-ssrf',
    category: 'command',
    severity: 'critical',
    pattern: /\b(?:curl|wget|fetch|http\.get|requests\.get|axios)\b[^\n]*(?:169\.254\.169\.254|metadata\.google|100\.100\.100\.200|localhost:\d|127\.0\.0\.1:\d|0\.0\.0\.0:\d|\[::1\]:\d)/i,
    description: 'SSRF targeting internal/metadata endpoints',
    contexts: ['prompt', 'shell'],
  },

  // ── Template injection ──────────────────────────────────────
  {
    rule: 'cmd-template-injection',
    category: 'command',
    severity: 'warning',
    pattern: /\{\{.*(?:config|settings|env|self|request|__class__|__globals__|__builtins__).*\}\}|<%.*(?:Runtime|Process|exec|system|eval).*%>|\$\{.*(?:Runtime|exec|java\.lang).*\}/i,
    description: 'Template injection patterns (Jinja2, EJS, JSP)',
    contexts: ['prompt', 'shell', 'display'],
  },

  // ── SQL injection ───────────────────────────────────────────
  {
    rule: 'cmd-sql-injection',
    category: 'command',
    severity: 'critical',
    pattern: /(?:\bUNION\s+(?:ALL\s+)?SELECT\b|\b;\s*DROP\s+TABLE\b|'\s*OR\s+['"]?1['"]?\s*=\s*['"]?1|'\s*;\s*(?:DELETE|INSERT|UPDATE|ALTER)\s)/i,
    description: 'SQL injection patterns',
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

/** Number of detection rules. Exported so tests + audit logs can assert
 * nothing was silently dropped during a refactor. */
export const RULE_COUNT = RULES.length

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

function scanVariant(
  text: string,
  context: NonNullable<GuardOptions['context']>,
  variantLabel: string,
): InjectionMatch[] {
  const found: InjectionMatch[] = []
  for (const rule of RULES) {
    if (!rule.contexts.includes(context)) continue
    const match = rule.pattern.exec(text)
    if (match) {
      found.push({
        category: rule.category,
        severity: rule.severity,
        rule: rule.rule,
        description: rule.description,
        matched: match[0].slice(0, 80),
        variant: variantLabel,
      })
    }
  }
  return found
}

/**
 * Scan a string for prompt injection, command injection, and exfiltration patterns.
 *
 * The scanner runs every applicable rule against:
 *   1. The original input
 *   2. The Layer-1-normalized input (homoglyphs collapsed, zero-width stripped, NFKC)
 *   3. ROT13 / URL / base64 decoded variants (when heuristics suggest them)
 *
 * Matches across variants are deduplicated by `rule` so the same attack
 * isn't reported twice. Returns a report with `safe: true` if no actionable
 * matches were found.
 */
export function scanForInjection(input: string, options: GuardOptions = {}): InjectionReport {
  const {
    criticalOnly = false,
    maxLength = 50_000,
    context = 'prompt',
    decodeVariants = true,
  } = options

  if (!input || typeof input !== 'string') {
    return { safe: true, matches: [] }
  }

  // Truncate overly long input to prevent ReDoS
  const text = input.length > maxLength ? input.slice(0, maxLength) : input

  // Variant 1: original (preserves existing test expectations)
  const allMatches: InjectionMatch[] = scanVariant(text, context, 'original')

  // Variant 2: Layer-1 normalized (homoglyphs + zero-width strip + NFKC)
  const normalized = normalizeForScanning(text)
  if (normalized !== text) {
    allMatches.push(...scanVariant(normalized, context, 'normalized'))
  }

  // Variant 3+: decoded variants (rot13, url, base64)
  if (decodeVariants) {
    for (const variant of generateDecodingVariants(text, maxLength)) {
      allMatches.push(...scanVariant(variant.text, context, variant.label))
    }
  }

  // Dedupe by rule name so a single attack matched across multiple variants
  // reports once. First occurrence wins on `variant` reporting.
  const seenRules = new Set<string>()
  const matches: InjectionMatch[] = []
  for (const m of allMatches) {
    if (seenRules.has(m.rule)) continue
    seenRules.add(m.rule)
    matches.push(m)
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

/** Scan for injection and log security event if unsafe */
export function scanAndLogInjection(text: string, options?: GuardOptions, context?: { agentName?: string; source?: string; workspaceId?: number }): InjectionReport {
  const report = scanForInjection(text, options)
  if (!report.safe) {
    try {
      const { logSecurityEvent } = require('./security-events')
      logSecurityEvent({ event_type: 'injection_attempt', severity: report.matches.some(m => m.severity === 'critical') ? 'critical' : 'warning', source: context?.source || 'injection-guard', agent_name: context?.agentName, detail: JSON.stringify({ matches: report.matches.map(m => ({ rule: m.rule, category: m.category, severity: m.severity, variant: m.variant })) }), workspace_id: context?.workspaceId || 1, tenant_id: 1 })
    } catch {}
  }
  return report
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
