import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger'
import { config } from './config'

// ---------------------------------------------------------------------------
// Startup security audit
//
// Scans recent git history and project files for patterns commonly associated
// with supply-chain attacks, prompt injection, or malicious payloads.  Runs
// once at startup and can be re-triggered via the scheduler.
// ---------------------------------------------------------------------------

export interface AuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  message: string
  file?: string
  line?: number
  detail?: string
}

export interface AuditResult {
  ok: boolean
  message: string
  findings: AuditFinding[]
  timestamp: number
  durationMs: number
}

// Number of recent commits to inspect
const COMMIT_SCAN_DEPTH = 50

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface DiffPattern {
  pattern: RegExp
  severity: AuditFinding['severity']
  category: string
  message: string
}

// Detects the "new Function(" constructor pattern used for dynamic code generation
const NEW_FUNCTION_CONSTRUCTOR = /new\s+Function\s*\(/

const DIFF_PATTERNS: DiffPattern[] = [
  // Shell / command execution injected in unexpected places
  {
    pattern: /\beval\s*\(/,
    severity: 'high',
    category: 'code-execution',
    message: 'eval() call added — potential arbitrary code execution',
  },
  {
    pattern: NEW_FUNCTION_CONSTRUCTOR,
    severity: 'high',
    category: 'code-execution',
    message: 'Dynamic Function constructor — potential arbitrary code execution',
  },
  {
    pattern: /child_process/,
    severity: 'medium',
    category: 'code-execution',
    message: 'child_process usage added — verify this is intentional',
  },
  {
    pattern: /execSync\s*\(|exec\s*\(/,
    severity: 'high',
    category: 'code-execution',
    message: 'Synchronous exec added — high risk of command injection if inputs are unsanitized',
  },

  // Obfuscation / encoding tricks
  {
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){3,}/,
    severity: 'high',
    category: 'obfuscation',
    message: 'Hex-encoded string sequence — possible obfuscated payload',
  },
  {
    pattern: /Buffer\.from\s*\([^)]*,\s*['"]base64['"]\s*\)\.toString\s*\(/,
    severity: 'medium',
    category: 'obfuscation',
    message: 'Base64 decode-to-string pattern — verify not hiding malicious code',
  },
  {
    pattern: /String\.fromCharCode\s*\(\s*\d+\s*(,\s*\d+\s*){5,}\)/,
    severity: 'high',
    category: 'obfuscation',
    message: 'Long fromCharCode sequence — common obfuscation technique',
  },

  // Network exfiltration
  {
    pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!api\.(anthropic|github|openai|telegram|openrouter)\.)/,
    severity: 'medium',
    category: 'network',
    message: 'Fetch to unknown external host — verify this is a trusted endpoint',
  },
  {
    pattern: /\.postMessage\s*\(/,
    severity: 'low',
    category: 'network',
    message: 'postMessage usage — can be used for cross-origin data exfiltration',
  },

  // Credential / secret access
  {
    pattern: /process\.env\[(?!['"][A-Z_]+['"])/,
    severity: 'medium',
    category: 'credentials',
    message: 'Dynamic process.env access — variable name is computed at runtime',
  },

  // Prototype pollution / supply-chain
  {
    pattern: /__proto__|Object\.setPrototypeOf|constructor\s*\[/,
    severity: 'high',
    category: 'prototype-pollution',
    message: 'Prototype manipulation — potential prototype pollution attack',
  },

  // Reverse shell / bind shell patterns
  {
    pattern: /\bnet\.Socket\b.*\bconnect\b|\bWebSocket\b.*\bnew\b.*(?:ws|wss):\/\/(?!127\.|localhost)/,
    severity: 'high',
    category: 'network',
    message: 'Outbound socket connection to non-local host — verify this is expected',
  },

  // Crypto wallet / key theft
  {
    pattern: /\.solana|solana.*keypair|phantom|\.config\/solana|id\.json/i,
    severity: 'critical',
    category: 'crypto-theft',
    message: 'Solana wallet / keypair access — potential crypto theft',
  },
  {
    pattern: /\.ethereum|keystore|wallet\.dat|\.bitcoin|\.config\/monero/i,
    severity: 'critical',
    category: 'crypto-theft',
    message: 'Crypto wallet file access — potential crypto theft',
  },
  {
    pattern: /metamask|phantom|backpack|solflare|ledger.*key|trezor.*key/i,
    severity: 'high',
    category: 'crypto-theft',
    message: 'Crypto wallet extension / hardware wallet reference — verify intent',
  },
  {
    pattern: /seed\s*phrase|mnemonic|bip39|bip44|private.?key.*(?:hex|base58|read|load|parse)/i,
    severity: 'critical',
    category: 'crypto-theft',
    message: 'Seed phrase / mnemonic / private key extraction pattern',
  },
  {
    pattern: /transferInstruction|SystemProgram\.transfer|sendTransaction.*(?:sign|lamport)/i,
    severity: 'critical',
    category: 'crypto-theft',
    message: 'Crypto transfer transaction construction — potential unauthorized transfer',
  },

  // Filesystem exfiltration / unauthorized file reads
  {
    pattern: /readFile.*(?:\/etc\/passwd|\/etc\/shadow|\.ssh|\.gnupg|\.aws\/credentials)/,
    severity: 'critical',
    category: 'file-exfiltration',
    message: 'Reading sensitive system files — potential credential theft',
  },
  {
    pattern: /readFile.*(?:\.env|\.npmrc|\.pypirc|\.docker\/config)/,
    severity: 'high',
    category: 'file-exfiltration',
    message: 'Reading credential / config files — potential secret exfiltration',
  },
  {
    pattern: /readdir.*(?:\.ssh|\.gnupg|\.aws|Desktop|Documents|Downloads)/,
    severity: 'high',
    category: 'file-exfiltration',
    message: 'Directory listing of sensitive locations — potential data enumeration',
  },
  {
    pattern: /homedir|os\.userInfo|process\.env\.HOME.*(?:readFile|readdir|createReadStream)/,
    severity: 'medium',
    category: 'file-exfiltration',
    message: 'Home directory discovery combined with file access — verify intent',
  },

  // Keylogging / input capture
  {
    pattern: /keydown|keypress|keyup.*(?:password|secret|key|token)/i,
    severity: 'high',
    category: 'keylogging',
    message: 'Keyboard event listener targeting sensitive input — potential keylogger',
  },
  {
    pattern: /clipboard|navigator\.clipboard|pbcopy|pbpaste|xclip|xsel/,
    severity: 'high',
    category: 'clipboard-theft',
    message: 'Clipboard access — potential data theft via clipboard',
  },

  // DNS / network reconnaissance
  {
    pattern: /dns\.lookup|dns\.resolve|whois|nslookup|dig\s/,
    severity: 'medium',
    category: 'reconnaissance',
    message: 'DNS lookup / network reconnaissance — verify intent',
  },

  // Cryptocurrency mining
  {
    pattern: /coinhive|cryptonight|stratum|xmrig|monero.*mine|crypto.*mine|hashrate/i,
    severity: 'critical',
    category: 'cryptomining',
    message: 'Cryptomining reference — potential unauthorized mining',
  },

  // Data exfiltration via DNS or non-standard channels
  {
    pattern: /encodeURI.*(?:fetch|http|dns|subdomain)/,
    severity: 'high',
    category: 'exfiltration',
    message: 'Encoded data sent over network — potential data exfiltration via URL encoding',
  },
  {
    pattern: /FormData.*(?:append.*File|append.*Blob)/,
    severity: 'medium',
    category: 'exfiltration',
    message: 'File upload via FormData — verify files being uploaded are expected',
  },
]

// ---------------------------------------------------------------------------
// Package.json checks
// ---------------------------------------------------------------------------

interface PkgPattern {
  check: (pkg: any) => string | null
  severity: AuditFinding['severity']
  category: string
}

const PKG_CHECKS: PkgPattern[] = [
  {
    check: (pkg) => {
      const scripts = pkg.scripts || {}
      for (const key of ['preinstall', 'postinstall', 'install']) {
        if (scripts[key]) return `"${key}" script found: ${scripts[key]}`
      }
      return null
    },
    severity: 'high',
    category: 'install-scripts',
  },
  {
    check: (pkg) => {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      for (const [name, version] of Object.entries(deps)) {
        const v = String(version)
        if (v.startsWith('git+') || v.startsWith('git://') || v.startsWith('http')) {
          return `Dependency "${name}" uses a git/http URL: ${v}`
        }
        if (v.startsWith('file:')) {
          return `Dependency "${name}" uses a local file path: ${v}`
        }
      }
      return null
    },
    severity: 'high',
    category: 'suspicious-deps',
  },
]

// ---------------------------------------------------------------------------
// Prompt injection / MCP config checks
// ---------------------------------------------------------------------------

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:different|new|my)\s+(?:AI|assistant|agent)/i,
  /disregard\s+(?:all\s+)?(?:prior|previous|above)/i,
  /system\s*:\s*you\s+(?:must|should|will|are)/i,
  /<\/?system(?:-|\s|>)/i,
  /\bACT\s+AS\b/i,
  /\bDAN\b.*\bjailbreak\b/i,
]

// ---------------------------------------------------------------------------
// Core audit functions
// ---------------------------------------------------------------------------

function gitExec(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, {
      cwd: cwd || process.cwd(),
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 5 * 1024 * 1024,
    }).toString('utf8')
  } catch {
    return ''
  }
}

function isGitRepo(): boolean {
  return gitExec(['rev-parse', '--is-inside-work-tree']).trim() === 'true'
}

function scanRecentCommits(findings: AuditFinding[]) {
  if (!isGitRepo()) return

  const log = gitExec([
    'log', `--max-count=${COMMIT_SCAN_DEPTH}`,
    '--format=%H %an <%ae>',
  ])
  if (!log.trim()) return

  const commits = log.trim().split('\n')

  for (const line of commits) {
    const [hash] = line.split(' ', 1)
    if (!hash) continue

    // Get the diff for this commit (added lines only)
    const diff = gitExec(['diff-tree', '-p', '--no-commit-id', hash, '--'])
    if (!diff) continue

    const diffLines = diff.split('\n')
    let currentFile = ''
    let lineNo = 0

    for (const dl of diffLines) {
      // Track which file we're in
      if (dl.startsWith('+++ b/')) {
        currentFile = dl.slice(6)
        lineNo = 0
        continue
      }
      if (dl.startsWith('@@')) {
        const match = dl.match(/@@ -\d+(?:,\d+)? \+(\d+)/)
        lineNo = match ? parseInt(match[1], 10) - 1 : 0
        continue
      }

      if (!dl.startsWith('+') || dl.startsWith('+++')) continue
      lineNo++

      // Skip non-source files
      if (/\.(md|txt|json|lock|css|svg|png|jpg|gif|ico)$/i.test(currentFile)) continue
      if (currentFile.startsWith('node_modules/')) continue

      const addedLine = dl.slice(1) // Remove leading +
      for (const pat of DIFF_PATTERNS) {
        if (pat.pattern.test(addedLine)) {
          findings.push({
            severity: pat.severity,
            category: pat.category,
            message: pat.message,
            file: currentFile,
            line: lineNo,
            detail: `commit ${hash.slice(0, 8)} | ${addedLine.trim().slice(0, 120)}`,
          })
        }
      }
    }
  }
}

function scanPackageJson(findings: AuditFinding[]) {
  const pkgPath = join(process.cwd(), 'package.json')
  if (!existsSync(pkgPath)) return

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    for (const check of PKG_CHECKS) {
      const msg = check.check(pkg)
      if (msg) {
        findings.push({
          severity: check.severity,
          category: check.category,
          message: msg,
          file: 'package.json',
        })
      }
    }
  } catch {
    // Can't parse package.json
  }
}

function scanPromptInjection(findings: AuditFinding[]) {
  // Scan CLAUDE.md files in the repo
  const claudeFiles = [
    join(process.cwd(), 'CLAUDE.md'),
    join(process.cwd(), '.claude', 'CLAUDE.md'),
  ]

  for (const fp of claudeFiles) {
    if (!existsSync(fp)) continue
    try {
      const content = readFileSync(fp, 'utf8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const pat of PROMPT_INJECTION_PATTERNS) {
          if (pat.test(lines[i])) {
            findings.push({
              severity: 'critical',
              category: 'prompt-injection',
              message: 'Potential prompt injection in agent instruction file',
              file: fp,
              line: i + 1,
              detail: lines[i].trim().slice(0, 120),
            })
          }
        }
      }
    } catch {
      // Can't read file
    }
  }

  // Scan MCP server configs for suspicious entries
  const mcpConfigPaths = [
    join(config.claudeHome, 'claude_desktop_config.json'),
    join(process.cwd(), '.mcp.json'),
    join(process.cwd(), '.claude', 'mcp.json'),
  ]

  for (const fp of mcpConfigPaths) {
    if (!existsSync(fp)) continue
    try {
      const content = readFileSync(fp, 'utf8')
      const parsed = JSON.parse(content)
      const servers = parsed.mcpServers || parsed.servers || {}

      for (const [name, serverConfig] of Object.entries(servers)) {
        const sc = serverConfig as any
        const cmd = sc.command || ''
        const args = (sc.args || []).join(' ')
        const combined = `${cmd} ${args}`

        // Flag servers that run curl/wget/nc (network tools)
        if (/\b(curl|wget|nc|ncat|socat)\b/.test(combined)) {
          findings.push({
            severity: 'high',
            category: 'mcp-server',
            message: `MCP server "${name}" uses network tool: ${cmd}`,
            file: fp,
            detail: combined.slice(0, 120),
          })
        }

        // Flag servers pointing to non-local URLs
        if (/https?:\/\/(?!localhost|127\.)/.test(combined)) {
          findings.push({
            severity: 'medium',
            category: 'mcp-server',
            message: `MCP server "${name}" connects to external URL`,
            file: fp,
            detail: combined.slice(0, 120),
          })
        }

        // Flag env vars being passed that look like they forward secrets
        const env = sc.env || {}
        for (const [envKey] of Object.entries(env)) {
          if (/TOKEN|SECRET|KEY|PASS/i.test(envKey)) {
            findings.push({
              severity: 'low',
              category: 'mcp-server',
              message: `MCP server "${name}" receives secret env var: ${envKey}`,
              file: fp,
            })
          }
        }
      }
    } catch {
      // Can't read/parse MCP config
    }
  }
}

// ---------------------------------------------------------------------------
// OpenClaw skills / soul templates / agent config checks
// ---------------------------------------------------------------------------

const SKILL_DANGER_PATTERNS = [
  // Prompt injection in skill definitions
  ...PROMPT_INJECTION_PATTERNS.map(p => ({
    pattern: p,
    severity: 'critical' as const,
    category: 'skill-prompt-injection',
    message: 'Prompt injection pattern in skill / soul template',
  })),
  // Crypto wallet access in skills
  {
    pattern: /wallet|solana|ethereum|keypair|seed.?phrase|mnemonic|private.?key|transfer.*sign/i,
    severity: 'critical',
    category: 'skill-crypto-access',
    message: 'Skill references crypto wallet operations — potential theft vector',
  },
  // File access in skills
  {
    pattern: /readFile|writeFile|readdir|unlink|rmdir|fs\.|filesystem/i,
    severity: 'high',
    category: 'skill-file-access',
    message: 'Skill references filesystem operations — verify scope is appropriate',
  },
  // Network access in skills
  {
    pattern: /fetch|http|curl|wget|request\.|axios|download/i,
    severity: 'high',
    category: 'skill-network-access',
    message: 'Skill references network operations — verify endpoints are trusted',
  },
  // Shell execution in skills
  {
    pattern: /exec|spawn|shell|bash|terminal|subprocess|child_process|command/i,
    severity: 'high',
    category: 'skill-shell-access',
    message: 'Skill references shell/command execution — high risk of arbitrary execution',
  },
  // Credential harvesting in skills
  {
    pattern: /password|credential|auth.*token|api.?key|secret|\.env|ssh.?key/i,
    severity: 'high',
    category: 'skill-credential-access',
    message: 'Skill references credential access — potential secret harvesting',
  },
  // Data exfiltration instructions
  {
    pattern: /send.*(?:file|data|content|secret|key|token).*(?:to|via|through|using)|upload.*(?:server|endpoint|url)/i,
    severity: 'critical',
    category: 'skill-exfiltration',
    message: 'Skill instructs sending data externally — potential data exfiltration',
  },
  // Permission escalation
  {
    pattern: /sudo|root|admin|superuser|privilege|escalat|bypass.*(?:auth|permission|security)/i,
    severity: 'high',
    category: 'skill-privilege-escalation',
    message: 'Skill references privilege escalation — verify intent',
  },
]

function scanOpenClawConfig(findings: AuditFinding[]) {
  // Scan openclaw.json for suspicious agent configurations
  if (!config.openclawConfigPath || !existsSync(config.openclawConfigPath)) return

  try {
    const content = readFileSync(config.openclawConfigPath, 'utf8')
    const parsed = JSON.parse(content)

    // Check agents' skills and tool permissions
    const agents = parsed.agents || []
    for (const agent of agents) {
      const name = agent.name || agent.id || 'unknown'

      // Check skills
      const skills = agent.skills || agent.tools || []
      for (const skill of skills) {
        const skillName = typeof skill === 'string' ? skill : (skill.name || skill.id || '')
        const skillStr = JSON.stringify(skill).toLowerCase()

        // Flag skills with overly broad filesystem access
        if (/\*\*\/\*|\/|~\/|homedir|root/.test(skillStr) && /read|write|file|fs/.test(skillStr)) {
          findings.push({
            severity: 'high',
            category: 'agent-config',
            message: `Agent "${name}" skill "${skillName}" has broad filesystem access`,
            file: config.openclawConfigPath,
            detail: skillStr.slice(0, 120),
          })
        }
      }

      // Check soul / system prompt for injection patterns
      const soulContent = agent.soul || agent.system_prompt || agent.instructions || ''
      if (soulContent) {
        const lines = soulContent.split('\n')
        for (let i = 0; i < lines.length; i++) {
          for (const sp of SKILL_DANGER_PATTERNS) {
            if (sp.pattern.test(lines[i])) {
              findings.push({
                severity: sp.severity as AuditFinding['severity'],
                category: sp.category,
                message: `Agent "${name}": ${sp.message}`,
                file: config.openclawConfigPath,
                line: i + 1,
                detail: lines[i].trim().slice(0, 120),
              })
            }
          }
        }
      }
    }
  } catch {
    // Can't read/parse openclaw.json
  }
}

function scanSoulTemplates(findings: AuditFinding[]) {
  if (!config.soulTemplatesDir || !existsSync(config.soulTemplatesDir)) return

  try {
    const files = readdirSync(config.soulTemplatesDir)
    for (const file of files) {
      if (!/\.(md|txt|yaml|yml|json|toml)$/i.test(file)) continue
      const filePath = join(config.soulTemplatesDir, file)
      try {
        const content = readFileSync(filePath, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          for (const sp of SKILL_DANGER_PATTERNS) {
            if (sp.pattern.test(lines[i])) {
              findings.push({
                severity: sp.severity as AuditFinding['severity'],
                category: sp.category,
                message: sp.message,
                file: filePath,
                line: i + 1,
                detail: lines[i].trim().slice(0, 120),
              })
            }
          }
        }
      } catch {
        // Can't read template
      }
    }
  } catch {
    // Can't read templates dir
  }
}

function scanSkillsDirectory(findings: AuditFinding[]) {
  // Scan common locations for OpenClaw skill definitions
  const skillDirs = [
    config.openclawStateDir ? join(config.openclawStateDir, 'skills') : '',
    config.openclawStateDir ? join(config.openclawStateDir, 'extensions') : '',
    config.openclawStateDir ? join(config.openclawStateDir, 'plugins') : '',
    join(process.cwd(), 'skills'),
    join(process.cwd(), 'extensions'),
  ].filter(d => d && existsSync(d))

  for (const dir of skillDirs) {
    try {
      const scanDir = (dirPath: string, depth = 0) => {
        if (depth > 3) return // Limit recursion depth
        const entries = readdirSync(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name)
          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1)
            continue
          }
          if (!/\.(ts|js|mjs|py|sh|yaml|yml|json|md|txt)$/i.test(entry.name)) continue

          try {
            const content = readFileSync(fullPath, 'utf8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              for (const sp of SKILL_DANGER_PATTERNS) {
                if (sp.pattern.test(lines[i])) {
                  findings.push({
                    severity: sp.severity as AuditFinding['severity'],
                    category: sp.category,
                    message: sp.message,
                    file: fullPath,
                    line: i + 1,
                    detail: lines[i].trim().slice(0, 120),
                  })
                }
              }
            }
          } catch {
            // Can't read skill file
          }
        }
      }
      scanDir(dir)
    } catch {
      // Can't read skills dir
    }
  }
}

// ---------------------------------------------------------------------------
// Environment & runtime checks
// ---------------------------------------------------------------------------

function scanEnvironment(findings: AuditFinding[]) {
  // Check for suspicious environment variables that may indicate compromise
  const suspiciousEnvPrefixes = ['MALWARE_', 'EXFIL_', 'C2_', 'BACKDOOR_', 'INJECT_']
  for (const key of Object.keys(process.env)) {
    if (suspiciousEnvPrefixes.some(p => key.startsWith(p))) {
      findings.push({
        severity: 'critical',
        category: 'environment',
        message: `Suspicious environment variable detected: ${key}`,
      })
    }
  }

  // Check for NODE_OPTIONS tampering (can preload malicious modules)
  const nodeOptions = process.env.NODE_OPTIONS || ''
  if (/--require|--loader|-r\s/.test(nodeOptions)) {
    findings.push({
      severity: 'high',
      category: 'environment',
      message: `NODE_OPTIONS preloads modules: ${nodeOptions}`,
      detail: 'Preloaded modules execute before application code and can intercept all operations',
    })
  }

  // Check for LD_PRELOAD / DYLD_INSERT_LIBRARIES (shared library injection)
  if (process.env.LD_PRELOAD) {
    findings.push({
      severity: 'critical',
      category: 'environment',
      message: `LD_PRELOAD is set: ${process.env.LD_PRELOAD}`,
      detail: 'Shared library injection can intercept any system call',
    })
  }
  if (process.env.DYLD_INSERT_LIBRARIES) {
    findings.push({
      severity: 'critical',
      category: 'environment',
      message: `DYLD_INSERT_LIBRARIES is set: ${process.env.DYLD_INSERT_LIBRARIES}`,
      detail: 'macOS shared library injection can intercept any system call',
    })
  }
}

function scanGitHooks(findings: AuditFinding[]) {
  const hooksDir = join(process.cwd(), '.git', 'hooks')
  if (!existsSync(hooksDir)) return

  try {
    const hooks = readdirSync(hooksDir).filter(f => !f.endsWith('.sample'))
    for (const hook of hooks) {
      const hookPath = join(hooksDir, hook)
      try {
        const content = readFileSync(hookPath, 'utf8')
        // Flag hooks that download or execute remote code
        if (/curl|wget|fetch|http/.test(content)) {
          findings.push({
            severity: 'high',
            category: 'git-hooks',
            message: `Git hook "${hook}" contains network access`,
            file: hookPath,
            detail: content.split('\n').find(l => /curl|wget|fetch|http/.test(l))?.trim().slice(0, 120),
          })
        }
      } catch {
        // Can't read hook
      }
    }
  } catch {
    // Can't read hooks dir
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSecurityAudit(): Promise<AuditResult> {
  const start = Date.now()
  const findings: AuditFinding[] = []

  try {
    scanRecentCommits(findings)
    scanPackageJson(findings)
    scanPromptInjection(findings)
    scanGitHooks(findings)
    scanOpenClawConfig(findings)
    scanSoulTemplates(findings)
    scanSkillsDirectory(findings)
    scanEnvironment(findings)
  } catch (err: any) {
    logger.error({ err }, 'Security audit encountered an error')
  }

  // Deduplicate findings (same file + line + category)
  const seen = new Set<string>()
  const deduped = findings.filter(f => {
    const key = `${f.file}:${f.line}:${f.category}:${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const criticalCount = deduped.filter(f => f.severity === 'critical').length
  const highCount = deduped.filter(f => f.severity === 'high').length
  const durationMs = Date.now() - start

  // Log summary
  if (deduped.length === 0) {
    logger.info(`Security audit passed (${durationMs}ms) — no findings`)
  } else {
    logger.warn(
      `Security audit completed (${durationMs}ms) — ${deduped.length} finding(s): ` +
      `${criticalCount} critical, ${highCount} high`
    )
    for (const f of deduped.filter(f => f.severity === 'critical' || f.severity === 'high')) {
      logger.warn(`  [${f.severity.toUpperCase()}] ${f.category}: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`)
    }
  }

  return {
    ok: criticalCount === 0 && highCount === 0,
    message: deduped.length === 0
      ? 'No security findings'
      : `${deduped.length} finding(s): ${criticalCount} critical, ${highCount} high`,
    findings: deduped,
    timestamp: Date.now(),
    durationMs,
  }
}
