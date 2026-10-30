import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tokenModule = await import('./lib/auto-login-token.cjs')
const { AUTO_LOGIN_TOKEN_FILE, writeAutoLoginToken } = tokenModule.default ?? tokenModule

if (!fs.existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))) {
  throw new Error('Run `pnpm build` before the next-start auto-login integration test')
}

const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
if (!fs.existsSync(nextBin)) {
  throw new Error(`Next.js CLI not found at ${nextBin}; run \`pnpm install\``)
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a test port')))
        return
      }
      const { port } = address
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 90_000
  let exit = null
  child.once('exit', (code, signal) => {
    exit = { code, signal }
  })

  while (Date.now() < deadline) {
    if (exit) throw new Error(`next start exited before becoming ready: ${JSON.stringify(exit)}`)
    try {
      const response = await fetch(`${baseUrl}/api/status?action=health`, { redirect: 'manual' })
      if (response.status > 0) return
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for next start')
}

const port = await availablePort()
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-auto-login-next-start-'))
const tokenPath = path.join(dataDir, AUTO_LOGIN_TOKEN_FILE)
let stderr = ''
const server = spawn(
  process.execPath,
  [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MISSION_CONTROL_DATA_DIR: dataDir,
      MISSION_CONTROL_DB_PATH: path.join(dataDir, 'mission-control.db'),
      MISSION_CONTROL_TOKENS_PATH: path.join(dataDir, 'mission-control-tokens.json'),
      MC_AUTO_LOGIN: '1',
      MC_DISABLE_RUNTIME_SCAN: '1',
      AUTH_USER: 'auto-login-test',
      AUTH_PASS: 'auto-login-test-password',
      AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
      API_KEY: crypto.randomBytes(24).toString('hex'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  },
)

server.stderr.on('data', (chunk) => {
  stderr += String(chunk)
})

after(async () => {
  if (!server.killed) server.kill()
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve(undefined)
    server.once('exit', () => resolve(undefined))
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
      resolve(undefined)
    }, 5_000).unref()
  })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('next start enforces navigation, token lifetime, and one-time use', { timeout: 120_000 }, async () => {
  await waitForServer(baseUrl, server)

  const issue = () => writeAutoLoginToken({ dataDir })
  const requestAutoLogin = (token, secFetchSite) => {
    const url = new URL('/api/auth/auto-login', baseUrl)
    url.searchParams.set('t', token)
    url.searchParams.set('next', '/chat')
    return fetch(url, {
      redirect: 'manual',
      headers: secFetchSite === null ? {} : { 'sec-fetch-site': secFetchSite },
    })
  }

  const missingNavigation = issue()
  const missingResponse = await requestAutoLogin(missingNavigation.token, null)
  assert.equal(missingResponse.status, 307)
  assert.match(missingResponse.headers.get('location') || '', /\/login$/)
  assert.equal(fs.existsSync(tokenPath), true)

  const crossSite = issue()
  const crossSiteResponse = await requestAutoLogin(crossSite.token, 'cross-site')
  assert.equal(crossSiteResponse.status, 307)
  assert.match(crossSiteResponse.headers.get('location') || '', /\/login$/)
  assert.equal(fs.existsSync(tokenPath), true)

  const expired = writeAutoLoginToken({ dataDir, now: Date.now() - 120_000 })
  const expiredResponse = await requestAutoLogin(expired.token, 'none')
  assert.equal(expiredResponse.status, 307)
  assert.match(expiredResponse.headers.get('location') || '', /\/login$/)
  assert.equal(expiredResponse.headers.get('set-cookie'), null)
  assert.equal(fs.existsSync(tokenPath), false)

  const valid = issue()
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600)
  }
  const validResponse = await requestAutoLogin(valid.token, 'none')
  assert.equal(validResponse.status, 307)
  assert.match(validResponse.headers.get('location') || '', /\/chat$/)
  assert.match(validResponse.headers.get('set-cookie') || '', /(?:__Host-)?mc-session=/)
  assert.equal(fs.existsSync(tokenPath), false)

  const replayResponse = await requestAutoLogin(valid.token, 'none')
  assert.equal(replayResponse.status, 307)
  assert.match(replayResponse.headers.get('location') || '', /\/login$/)
  assert.equal(replayResponse.headers.get('set-cookie'), null)
})

process.on('exit', () => {
  if (stderr && server.exitCode !== 0) process.stderr.write(stderr)
})
