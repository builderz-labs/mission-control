#!/usr/bin/env node

const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')

const SOCKET_PATH = process.env.MC_PROVISIONER_SOCKET || '/run/mc-provisioner.sock'
const TOKEN = String(process.env.MC_PROVISIONER_TOKEN || '')
const SOCKET_GROUP = process.env.MC_PROVISIONER_GROUP || 'openclaw'

if (!TOKEN) {
  console.error('MC_PROVISIONER_TOKEN is required')
  process.exit(1)
}

function isSafeUser(user) {
  return /^[a-z_][a-z0-9_-]{1,30}$/.test(user)
}

function isSafeHomePath(path, user, suffix) {
  return path === `/home/${user}/${suffix}`
}

function validateCommand(command, args) {
  const cmd = String(command || '').split('/').pop()
  if (!command || !Array.isArray(args)) return 'Invalid command payload'

  if (cmd === 'useradd') {
    if (args.length !== 4) return 'useradd argument mismatch'
    const [a, b, shell, user] = args
    if (a !== '-m' || b !== '-s' || shell !== '/bin/bash') return 'useradd args not allowed'
    if (!isSafeUser(user)) return 'Invalid username'
    return null
  }

  if (cmd === 'install') {
    if (args.length !== 8) return 'install argument mismatch'
    const [d, mFlag, mode, oFlag, userA, gFlag, userB, target] = args
    if (d !== '-d' || mFlag !== '-m' || oFlag !== '-o' || gFlag !== '-g') return 'install args not allowed'
    if (!['0750', '0700'].includes(mode)) return 'install mode not allowed'
    const isRootOwned = userA === 'root' && userB === 'root'
    const isTenantOwned = isSafeUser(userA) && isSafeUser(userB) && userA === userB
    if (!isRootOwned && !isTenantOwned) return 'install ownership not allowed'
    const openclawPath = `/home/${userA}/.openclaw`
    const workspacePath = `/home/${userA}/workspace`
    if (isRootOwned && target === '/etc/openclaw-tenants') return null
    if (![openclawPath, workspacePath].includes(target)) return 'install path not allowed'
    return null
  }

  if (cmd === 'cp') {
    if (args.length !== 3) return 'cp argument mismatch'
    const [flag, source, target] = args
    if (!['-n', '-f'].includes(flag)) return 'cp flag not allowed'
    if (source === '/home/openclaw/.openclaw/openclaw.json') {
      if (flag !== '-n') return 'openclaw config copy must use -n'
      const match = /^\/home\/([a-z_][a-z0-9_-]{1,30})\/\.openclaw\/openclaw\.json$/.exec(target)
      if (!match) return 'cp target not allowed'
      return null
    }
    if (source === '/home/openclaw/repos/mission-control/ops/templates/openclaw-gateway@.service') {
      if (flag !== '-n') return 'template copy must use -n'
      if (target !== '/etc/systemd/system/openclaw-gateway@.service') return 'gateway template target not allowed'
      return null
    }
    if (/^\/home\/openclaw\/repos\/mission-control\/\.data\/provisioner\/[a-z0-9-]{3,32}\/openclaw-gateway\.env$/.test(source)) {
      if (flag !== '-f') return 'tenant env copy must use -f'
      if (!/^\/etc\/openclaw-tenants\/[a-z_][a-z0-9_-]{1,30}\.env$/.test(target)) return 'tenant env target not allowed'
      return null
    }
    return 'cp source not allowed'
  }

  if (cmd === 'chown') {
    if (args.length !== 3) return 'chown argument mismatch'
    const [rFlag, owner, target] = args
    if (rFlag !== '-R') return 'chown must use -R'
    const [userA, userB] = owner.split(':')
    if (!isSafeUser(userA) || userA !== userB) return 'chown owner not allowed'
    if (target !== `/home/${userA}`) return 'chown target not allowed'
    return null
  }

  if (cmd === 'rm') {
    if (args.length !== 2) return 'rm argument mismatch'
    const [flag, target] = args

    if (flag === '-f') {
      if (!/^\/etc\/openclaw-tenants\/[a-z_][a-z0-9_-]{1,30}\.env$/.test(target)) {
        return 'rm -f target not allowed'
      }
      return null
    }

    if (flag === '-rf') {
      const match = /^\/home\/([a-z_][a-z0-9_-]{1,30})\/(\.openclaw|workspace)$/.exec(target)
      if (!match) return 'rm -rf target not allowed'
      return null
    }

    return 'rm flag not allowed'
  }

  if (cmd === 'userdel') {
    if (args.length !== 2) return 'userdel argument mismatch'
    if (args[0] !== '-r') return 'userdel must use -r'
    if (!isSafeUser(args[1])) return 'Invalid username'
    return null
  }

  if (cmd === 'true') {
    if (args.length !== 0) return 'true takes no args'
    return null
  }

  if (cmd === 'systemctl') {
    if (args.length === 1 && args[0] === 'daemon-reload') return null
    if (args.length === 3 && args[0] === 'enable' && args[1] === '--now') {
      if (/^openclaw-gateway@[a-z_][a-z0-9_-]{1,30}\.service$/.test(args[2])) return null
      return 'systemctl service name not allowed'
    }
    if (args.length === 3 && args[0] === 'disable' && args[1] === '--now') {
      if (/^openclaw-gateway@[a-z_][a-z0-9_-]{1,30}\.service$/.test(args[2])) return null
      return 'systemctl service name not allowed'
    }
    return 'systemctl args not allowed'
  }

  return `Command not allowlisted: ${command}`
}

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, Math.max(1000, Number(timeoutMs || 10000)))

    child.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { stderr += d.toString('utf8') })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: !timedOut && code === 0,
        code: timedOut ? 124 : code,
        stdout,
        stderr: timedOut ? `${stderr}\nTimed out` : stderr,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 1, stdout, stderr: `${stderr}\n${err.message}` })
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runWithRetry(command, args, timeoutMs) {
  const cmd = String(command || '').split('/').pop()
  const maxAttempts = cmd === 'useradd' ? 6 : 1
  let last = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await run(command, args, timeoutMs)
    last = result
    if (result.ok) return result

    const transientLock =
      cmd === 'useradd' &&
      /cannot lock \/etc\/passwd/i.test(String(result.stderr || ''))

    if (!transientLock || attempt === maxAttempts) {
      return result
    }
    await sleep(800)
  }

  return last || { ok: false, code: 1, stdout: '', stderr: 'Unknown execution failure' }
}

function writeResp(socket, obj) {
  try {
    socket.write(JSON.stringify(obj) + '\n')
  } catch {
    // no-op
  } finally {
    socket.end()
  }
}

if (fs.existsSync(SOCKET_PATH)) {
  try {
    fs.unlinkSync(SOCKET_PATH)
  } catch (err) {
    console.error(`Failed to remove stale socket ${SOCKET_PATH}:`, err.message)
    process.exit(1)
  }
}

const server = net.createServer((socket) => {
  let buf = ''

  socket.on('data', async (chunk) => {
    buf += chunk.toString('utf8')
    const idx = buf.indexOf('\n')
    if (idx === -1) return

    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)

    let req
    try {
      req = JSON.parse(line)
    } catch {
      writeResp(socket, { ok: false, error: 'Invalid JSON' })
      return
    }

    if (!req || req.token !== TOKEN) {
      writeResp(socket, { ok: false, error: 'Unauthorized' })
      return
    }

    const command = String(req.command || '')
    const args = Array.isArray(req.args) ? req.args.map((a) => String(a)) : []
    const dryRun = !!req.dryRun
    const timeoutMs = Number(req.timeoutMs || 10000)

    const validationErr = validateCommand(command, args)
    if (validationErr) {
      writeResp(socket, { ok: false, error: validationErr })
      return
    }

    if (dryRun) {
      writeResp(socket, { ok: true, code: 0, stdout: '', stderr: '', skipped: true })
      return
    }

    const result = await runWithRetry(command, args, timeoutMs)
    if (!result.ok) {
      writeResp(socket, { ok: false, code: result.code, stdout: result.stdout, stderr: result.stderr, error: `Command failed: ${command}` })
      return
    }

    writeResp(socket, { ok: true, code: result.code, stdout: result.stdout, stderr: result.stderr, skipped: false })
  })
})

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660)
  try {
    const group = require('child_process').execSync(`getent group ${SOCKET_GROUP} | cut -d: -f3`).toString('utf8').trim()
    const gid = Number(group)
    if (Number.isInteger(gid)) {
      fs.chownSync(SOCKET_PATH, 0, gid)
    }
  } catch {
    // fallback: keep root:root
  }
  console.log(`mc-provisioner listening on ${SOCKET_PATH}`)
})

function shutdown() {
  try { server.close() } catch {}
  try { fs.unlinkSync(SOCKET_PATH) } catch {}
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
