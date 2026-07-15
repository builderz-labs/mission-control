import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { requireRole, getUserFromRequest } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { logger } from '@/lib/logger'
import { resolvePinnedUserToolSpec, runtimeInstallsEnabled } from '@/lib/runtime-install-security'
import type { UserRuntimeTool } from '@/lib/runtime-install-security'

export interface OsUser {
  username: string
  uid: number
  home_dir: string
  shell: string
  /** Whether this OS user is already linked to a tenant in the DB */
  linked_tenant_id: number | null
  /** Whether claude CLI is installed/accessible for this user */
  has_claude: boolean
  /** Whether codex CLI is installed/accessible for this user */
  has_codex: boolean
  /** Whether openclaw is installed for this user */
  has_openclaw: boolean
  /** Whether this OS user is the one running the MC process (i.e. "Default" org) */
  is_process_owner: boolean
}

// Well-known service account usernames to exclude from OS user discovery.
// These are created by package managers (Homebrew, apt, etc.) and are not real users.
const SERVICE_ACCOUNTS = new Set([
  'postgres', 'mysql', 'redis', 'mongodb', 'memcached', 'rabbitmq',
  'elasticsearch', 'kibana', 'logstash', 'grafana', 'prometheus',
  'nginx', 'apache', 'www-data', 'httpd', 'caddy',
  'git', 'svn', 'jenkins', 'gitlab-runner', 'circleci',
  'docker', 'containerd', 'podman',
  'node', 'npm', 'yarn',
  'sshd', 'ftp', 'mail', 'postfix', 'dovecot',
  'solr', 'kafka', 'zookeeper', 'consul', 'vault', 'nomad',
  'influxdb', 'clickhouse', 'cassandra', 'couchdb',
  'puppet', 'chef', 'ansible', 'terraform',
  'ntp', 'chrony', 'systemd-network', 'systemd-resolve',
])

/** Check if a CLI tool (claude, codex) is accessible for a given user home dir */
function checkToolExists(homeDir: string, tool: string): boolean {
  // Check common install locations relative to user home
  const candidates = [
    path.join(/*turbopackIgnore: true*/ homeDir, '.local', 'bin', tool),
    path.join(/*turbopackIgnore: true*/ homeDir, '.npm-global', 'bin', tool),
    path.join(/*turbopackIgnore: true*/ homeDir, `.${tool}`), // e.g. ~/.claude, ~/.openclaw config dir = installed
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(/*turbopackIgnore: true*/ p)) return true } catch {}
  }
  // Also check system-wide
  try {
    execFileSync('/usr/bin/which', [tool], { encoding: 'utf-8', timeout: 2000, stdio: 'pipe' })
    return true
  } catch {}
  return false
}

/** Install a tool (openclaw, claude, codex) for a given OS user. Non-fatal — returns success/error. */
function installToolForUser(
  homeDir: string,
  username: string,
  tool: UserRuntimeTool,
  packageSpec: string,
): { success: boolean; error?: string } {
  try {
    if (tool === 'openclaw') {
      // OpenClaw is managed by MC — create its directory structure and install
      // the operator-reviewed immutable Git commit.
      const openclawDir = path.join(/*turbopackIgnore: true*/ homeDir, '.openclaw')
      const workspaceDir = path.join(/*turbopackIgnore: true*/ homeDir, 'workspace')
      for (const dir of [openclawDir, workspaceDir]) {
        try {
          execFileSync('/usr/bin/sudo', ['-n', 'install', '-d', '-o', username, dir], { timeout: 5000, stdio: 'pipe' })
        } catch {
          // Fallback: mkdir directly (works if running as that user or root)
          fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
        }
      }
      try {
        execFileSync('/usr/bin/sudo', ['-n', '-u', username, 'npm', 'install', '-g', packageSpec], {
          timeout: 120000,
          stdio: 'pipe',
          env: { ...process.env, HOME: homeDir },
        })
      } catch (npmErr: any) {
        // Dir structure created but npm install failed — still partially useful
        const msg = npmErr?.stderr?.toString?.()?.slice(0, 200) || npmErr?.message || 'npm install failed'
        logger.warn({ tool, username, err: msg }, 'openclaw npm install failed, dir structure created')
        return { success: true, error: `dirs created but npm install failed: ${msg}` }
      }
      return { success: true }
    }

    if (tool === 'claude') {
      // Install claude code CLI globally for the user
      try {
        execFileSync('/usr/bin/sudo', ['-n', '-u', username, 'npm', 'install', '-g', packageSpec], {
          timeout: 120000,
          stdio: 'pipe',
          env: { ...process.env, HOME: homeDir },
        })
      } catch (npmErr: any) {
        // Fallback: create config dir so checkToolExists detects it
        const claudeDir = path.join(/*turbopackIgnore: true*/ homeDir, '.claude')
        try {
          execFileSync('/usr/bin/sudo', ['-n', 'install', '-d', '-o', username, claudeDir], { timeout: 5000, stdio: 'pipe' })
        } catch {
          fs.mkdirSync(/*turbopackIgnore: true*/ claudeDir, { recursive: true })
        }
        const msg = npmErr?.stderr?.toString?.()?.slice(0, 200) || npmErr?.message || 'npm install failed'
        return { success: false, error: msg }
      }
      return { success: true }
    }

    if (tool === 'codex') {
      // Install codex CLI globally for the user
      try {
        execFileSync('/usr/bin/sudo', ['-n', '-u', username, 'npm', 'install', '-g', packageSpec], {
          timeout: 120000,
          stdio: 'pipe',
          env: { ...process.env, HOME: homeDir },
        })
      } catch (npmErr: any) {
        // Fallback: create config dir so checkToolExists detects it
        const codexDir = path.join(/*turbopackIgnore: true*/ homeDir, '.codex')
        try {
          execFileSync('/usr/bin/sudo', ['-n', 'install', '-d', '-o', username, codexDir], { timeout: 5000, stdio: 'pipe' })
        } catch {
          fs.mkdirSync(/*turbopackIgnore: true*/ codexDir, { recursive: true })
        }
        const msg = npmErr?.stderr?.toString?.()?.slice(0, 200) || npmErr?.message || 'npm install failed'
        return { success: false, error: msg }
      }
      return { success: true }
    }

    return { success: false, error: `Unknown tool: ${tool}` }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Unknown error' }
  }
}

/**
 * Discover real (non-system, non-service) OS-level user accounts.
 * macOS: dscl (Directory Services)
 * Linux: getent passwd
 *
 * Uses execFileSync (no shell) to prevent command injection.
 */
function discoverOsUsers(): OsUser[] {
  const platform = os.platform()
  const users: OsUser[] = []

  try {
    if (platform === 'darwin') {
      // macOS: list users + UIDs via dscl (no shell needed)
      const raw = execFileSync('/usr/bin/dscl', ['.', 'list', '/Users', 'UniqueID'], { encoding: 'utf-8', timeout: 5000 })
      for (const line of raw.split('\n')) {
        const match = line.match(/^(\S+)\s+(\d+)$/)
        if (!match) continue
        const [, username, uidStr] = match
        const uid = parseInt(uidStr, 10)
        // Skip system accounts (uid < 500 on macOS), special users, and known service accounts
        if (uid < 500 || username.startsWith('_') || username === 'nobody' || username === 'root' || username === 'daemon') continue
        if (SERVICE_ACCOUNTS.has(username)) continue

        let homeDir = `/Users/${username}`
        let shell = '/bin/zsh'
        try {
          const info = execFileSync('/usr/bin/dscl', ['.', 'read', `/Users/${username}`, 'NFSHomeDirectory', 'UserShell'], { encoding: 'utf-8', timeout: 3000 })
          const homeMatch = info.match(/NFSHomeDirectory:\s*(.+)/)
          const shellMatch = info.match(/UserShell:\s*(.+)/)
          if (homeMatch) homeDir = homeMatch[1].trim()
          if (shellMatch) shell = shellMatch[1].trim()
        } catch {}

        const hasClaude = checkToolExists(homeDir, 'claude')
        const hasCodex = checkToolExists(homeDir, 'codex')
        const hasOpenclaw = checkToolExists(homeDir, 'openclaw')
        users.push({ username, uid, home_dir: homeDir, shell, linked_tenant_id: null, has_claude: hasClaude, has_codex: hasCodex, has_openclaw: hasOpenclaw, is_process_owner: false })
      }
    } else if (platform === 'linux') {
      // Linux: getent passwd returns colon-separated fields (no shell needed)
      const raw = execFileSync('/usr/bin/getent', ['passwd'], { encoding: 'utf-8', timeout: 5000 })
      for (const line of raw.split('\n')) {
        const parts = line.split(':')
        if (parts.length < 7) continue
        const [username, , uidStr, , , homeDir, shell] = parts
        const uid = parseInt(uidStr, 10)
        // Skip system accounts (uid < 1000 on Linux), nfsnobody, and known service accounts
        if (uid < 1000 || username === 'nobody' || username === 'nfsnobody') continue
        if (SERVICE_ACCOUNTS.has(username)) continue
        // Skip users with non-interactive shells (service accounts that slipped through)
        if (shell.endsWith('/nologin') || shell.endsWith('/false')) continue

        const hasClaude = checkToolExists(homeDir, 'claude')
        const hasCodex = checkToolExists(homeDir, 'codex')
        const hasOpenclaw = checkToolExists(homeDir, 'openclaw')
        users.push({ username, uid, home_dir: homeDir, shell, linked_tenant_id: null, has_claude: hasClaude, has_codex: hasCodex, has_openclaw: hasOpenclaw, is_process_owner: false })
      }
    }
  } catch {
    // If discovery fails (permissions, missing binary), return empty
  }

  return users.sort((a, b) => a.uid - b.uid)
}

/**
 * GET /api/super/os-users - Discover OS-level user accounts (admin only)
 *
 * Returns discovered OS users cross-referenced with existing tenants.
 * Users already linked to a tenant have linked_tenant_id set.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const users = discoverOsUsers()

  // Mark the OS user that owns the MC process (represented by "Default" org)
  const processHomeDir = os.homedir()
  for (const user of users) {
    if (user.home_dir === processHomeDir) {
      user.is_process_owner = true
    }
  }

  // Cross-reference with existing tenants to mark linked ones
  try {
    const { listTenants } = await import('@/lib/super-admin')
    const tenants = listTenants()
    const tenantByLinuxUser = new Map(tenants.map(t => [t.linux_user, t.id]))
    for (const user of users) {
      user.linked_tenant_id = tenantByLinuxUser.get(user.username) ?? null
    }
  } catch {}

  return NextResponse.json({ users, platform: os.platform() })
}

/**
 * POST /api/super/os-users - Create a new OS-level user and register as tenant (admin only)
 *
 * Local mode: creates OS user + home dir, registers in tenants table as active
 * Gateway mode: creates OS user + delegates to full bootstrap pipeline (openclaw + workspace + agents)
 *
 * Body: { username, display_name, password?, gateway_mode?: boolean, gateway_port?, owner_gateway? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const currentUser = getUserFromRequest(request)
  const actor = currentUser?.username || 'system'

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  const username = String(body.username || '').trim().toLowerCase()
  const displayName = String(body.display_name || '').trim()
  const password = body.password ? String(body.password) : undefined
  const gatewayMode = !!body.gateway_mode
  const installOpenclaw = !!body.install_openclaw
  const installClaude = !!body.install_claude
  const installCodex = !!body.install_codex
  const toolsToInstall: UserRuntimeTool[] = []
  if (installOpenclaw) toolsToInstall.push('openclaw')
  // When OpenClaw is selected, Claude and Codex are bundled.
  if (installClaude && !installOpenclaw) toolsToInstall.push('claude')
  if (installCodex && !installOpenclaw) toolsToInstall.push('codex')

  const pinnedToolSpecs = new Map<UserRuntimeTool, string>()
  if (toolsToInstall.length > 0) {
    if (!runtimeInstallsEnabled()) {
      return NextResponse.json({
        error: 'Runtime installs are disabled. Set MC_ENABLE_RUNTIME_INSTALLS=1 after reviewing the supply-chain requirements.',
      }, { status: 403 })
    }
    for (const tool of toolsToInstall) {
      const resolved = resolvePinnedUserToolSpec(tool)
      if ('error' in resolved) {
        return NextResponse.json({ error: resolved.error, tool }, { status: 400 })
      }
      pinnedToolSpecs.set(tool, resolved.spec)
    }
  }

  // Validate username (safe for OS user creation — alphanumeric + dash/underscore)
  if (!/^[a-z][a-z0-9_-]{1,30}[a-z0-9]$/.test(username)) {
    return NextResponse.json({ error: 'Invalid username. Use lowercase letters, numbers, dashes, and underscores (3-32 chars).' }, { status: 400 })
  }
  if (!displayName) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
  }
  if (SERVICE_ACCOUNTS.has(username)) {
    return NextResponse.json({ error: 'Cannot use a reserved service account name' }, { status: 400 })
  }

  // Check if user already exists on OS
  const existingUsers = discoverOsUsers()
  const alreadyExists = existingUsers.some(u => u.username === username)

  // Check if already registered as tenant
  const db = getDatabase()
  const existingTenant = db.prepare('SELECT id FROM tenants WHERE linux_user = ? OR slug = ?').get(username, username) as any
  if (existingTenant) {
    return NextResponse.json({ error: 'This user is already registered as an organization' }, { status: 409 })
  }

  const platform = os.platform()

  // Gateway mode: delegate to full provisioning pipeline
  if (gatewayMode) {
    try {
      const { createTenantAndBootstrapJob } = await import('@/lib/super-admin')
      const result = createTenantAndBootstrapJob({
        slug: username,
        display_name: displayName,
        linux_user: username,
        gateway_port: body.gateway_port ? Number(body.gateway_port) : undefined,
        owner_gateway: body.owner_gateway || undefined,
        dry_run: body.dry_run !== false,
        config: { install_openclaw: installOpenclaw, install_claude: installClaude, install_codex: installCodex },
      }, actor)
      return NextResponse.json(result, { status: 201 })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Failed to create tenant bootstrap job' }, { status: 400 })
    }
  }

  // Local mode: create OS user directly + register in tenants table
  try {
    if (!alreadyExists) {
      if (platform === 'darwin') {
        // macOS: use sysadminctl to create user (requires admin/sudo)
        const args = ['-addUser', username, '-fullName', displayName, '-home', `/Users/${username}`]
        if (password) {
          args.push('-password', password)
        } else {
          args.push('-password', '') // empty password, can be set later
        }
        try {
          execFileSync('/usr/sbin/sysadminctl', args, { timeout: 15000, stdio: 'pipe' })
        } catch (e: any) {
          // sysadminctl may need sudo — try with sudo
          try {
            execFileSync('/usr/bin/sudo', ['-n', '/usr/sbin/sysadminctl', ...args], { timeout: 15000, stdio: 'pipe' })
          } catch (sudoErr: any) {
            const msg = sudoErr?.stderr?.toString?.() || sudoErr?.message || 'Failed to create OS user'
            logger.error({ err: sudoErr }, 'Failed to create macOS user')
            return NextResponse.json({
              error: `Failed to create OS user. This requires admin privileges. ${msg}`,
              hint: 'Run Mission Control with sudo or grant the current user admin rights.',
            }, { status: 500 })
          }
        }
      } else if (platform === 'linux') {
        // Linux: useradd
        const args = ['-m', '-s', '/bin/bash', '-c', displayName, username]
        try {
          execFileSync('/usr/bin/sudo', ['-n', '/usr/sbin/useradd', ...args], { timeout: 15000, stdio: 'pipe' })
        } catch (e: any) {
          const msg = e?.stderr?.toString?.() || e?.message || 'Failed to create OS user'
          logger.error({ err: e }, 'Failed to create Linux user')
          return NextResponse.json({
            error: `Failed to create OS user: ${msg}`,
            hint: 'Ensure the MC process user has passwordless sudo for useradd.',
          }, { status: 500 })
        }

        // Set password if provided
        if (password) {
          try {
            execFileSync('/usr/bin/sudo', ['-n', '/usr/sbin/chpasswd'], {
              timeout: 5000,
              input: `${username}:${password}`,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
          } catch {
            // Non-critical — user created but password not set
          }
        }
      } else {
        return NextResponse.json({ error: `OS user creation not supported on ${platform}` }, { status: 400 })
      }
    }

    // Determine home directory for the new user
    const homeDir = platform === 'darwin' ? `/Users/${username}` : `/home/${username}`
    const openclawHome = path.posix.join(/*turbopackIgnore: true*/ homeDir, '.openclaw')
    const workspaceRoot = path.posix.join(/*turbopackIgnore: true*/ homeDir, 'workspace')

    // Register as tenant in DB
    const tenantRes = db.prepare(`
      INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, gateway_port, dashboard_port, config, created_by, owner_gateway)
      VALUES (?, ?, ?, 'local', 'active', ?, ?, NULL, NULL, '{}', ?, 'local')
    `).run(username, displayName, username, openclawHome, workspaceRoot, actor)

    const tenantId = Number(tenantRes.lastInsertRowid)

    logAuditEvent({
      action: 'tenant_local_created',
      actor,
      target_type: 'tenant',
      target_id: tenantId,
      detail: { username, display_name: displayName, os_user_existed: alreadyExists, platform },
    })

    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)

    // Install requested tools (non-fatal)
    const installResults: Record<string, { success: boolean; error?: string }> = {}
    for (const tool of toolsToInstall) {
      installResults[tool] = installToolForUser(homeDir, username, tool, pinnedToolSpecs.get(tool)!)
    }

    const installSummary = Object.entries(installResults)
      .map(([tool, r]) => r.success ? `${tool} installed` : `${tool} failed: ${r.error}`)
      .join('. ')

    const baseMsg = alreadyExists
      ? `OS user "${username}" already existed. Registered as organization.`
      : `OS user "${username}" created and registered as organization.`

    return NextResponse.json({
      tenant,
      os_user_created: !alreadyExists,
      install_results: Object.keys(installResults).length > 0 ? installResults : undefined,
      message: installSummary ? `${baseMsg} ${installSummary}.` : baseMsg,
    }, { status: 201 })
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return NextResponse.json({ error: 'Organization slug or user already exists' }, { status: 409 })
    }
    logger.error({ err: e }, 'POST /api/super/os-users error')
    return NextResponse.json({ error: e?.message || 'Failed to create organization' }, { status: 500 })
  }
}
