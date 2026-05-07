#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { randomBytes } from 'node:crypto'

const projectDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const gatewayDevicesDir = path.join(projectDir, '.openclaw-data', 'devices')
const gatewayConfigPath = path.join(projectDir, '.openclaw-data', 'openclaw.json')
const pendingPath = path.join(gatewayDevicesDir, 'pending.json')
const pairedPath = path.join(gatewayDevicesDir, 'paired.json')

const shouldWatch = process.argv.includes('--watch')
const intervalMs = Math.max(Number(process.env.OPENCLAW_CONTROL_UI_AUTO_APPROVE_INTERVAL_MS || 1000), 250)
const autoApproveEnabled = process.env.OPENCLAW_LOCAL_DEV_AUTO_APPROVE === '1'

function log(message) {
  process.stdout.write(`[control-ui-auto-pair] ${message}\n`)
}

function logError(message) {
  process.stderr.write(`[control-ui-auto-pair] ERROR: ${message}\n`)
}

function loadJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${filePath} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function writeJsonAtomic(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function isPrivateOrLoopbackIp(ip) {
  if (typeof ip !== 'string' || ip.trim().length === 0) return false
  const normalized = ip.trim().toLowerCase()
  if (normalized === '127.0.0.1' || normalized === '::1') return true
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true
  if (normalized.startsWith('172.')) {
    const octet = Number(normalized.split('.')[1] || '')
    return Number.isInteger(octet) && octet >= 16 && octet <= 31
  }
  return normalized.startsWith('fc') || normalized.startsWith('fd')
}

function isLocalDevMode() {
  const config = loadJson(gatewayConfigPath, {})
  const mode = config?.gateway?.mode
  return mode === 'local'
}

function generateToken() {
  return randomBytes(32).toString('base64url')
}

function isEligibleControlUiRequest(request) {
  if (!request || typeof request !== 'object') return false

  const clientId = typeof request.clientId === 'string' ? request.clientId : ''
  if (clientId !== 'openclaw-control-ui') return false

  const remoteIp = typeof request.remoteIp === 'string' ? request.remoteIp : ''
  if (!isPrivateOrLoopbackIp(remoteIp)) return false

  const scopes = Array.isArray(request.scopes) ? request.scopes.filter(scope => typeof scope === 'string') : []
  return scopes.length > 0
}

function buildPairedEntry(request, token, nowMs) {
  const role = typeof request.role === 'string' && request.role.trim().length > 0 ? request.role : 'operator'
  const roles = Array.isArray(request.roles) && request.roles.every(item => typeof item === 'string')
    ? request.roles
    : [role]
  const scopes = Array.isArray(request.scopes) && request.scopes.length > 0
    ? request.scopes.filter(scope => typeof scope === 'string')
    : ['operator.pairing']

  return {
    deviceId: request.deviceId,
    publicKey: request.publicKey,
    platform: request.platform,
    clientId: request.clientId,
    clientMode: request.clientMode,
    role,
    roles,
    scopes,
    approvedScopes: scopes,
    tokens: {
      operator: {
        token,
        role,
        scopes,
        createdAtMs: nowMs,
      },
    },
    createdAtMs: nowMs,
    approvedAtMs: nowMs,
  }
}

function sweepPendingRequests() {
  if (!autoApproveEnabled) {
    return { approved: 0, removedPending: 0, skipped: 0, reason: 'disabled' }
  }

  if (!isLocalDevMode()) {
    return { approved: 0, removedPending: 0, skipped: 0, reason: 'non-local-mode' }
  }

  const pendingById = loadJson(pendingPath, {})
  const pairedByDeviceId = loadJson(pairedPath, {})

  let approved = 0
  let removedPending = 0
  let skipped = 0
  let changedPending = false
  let changedPaired = false

  for (const [requestId, request] of Object.entries(pendingById)) {
    if (!isEligibleControlUiRequest(request)) {
      skipped += 1
      continue
    }

    if (!request || typeof request !== 'object' || typeof request.deviceId !== 'string' || typeof request.publicKey !== 'string') {
      skipped += 1
      continue
    }

    const nowMs = Date.now()
    const existing = pairedByDeviceId[request.deviceId]
    if (existing && existing.publicKey && existing.publicKey !== request.publicKey) {
      skipped += 1
      continue
    }

    const existingToken = existing?.tokens?.operator?.token
    const token = typeof existingToken === 'string' && existingToken.trim().length > 0
      ? existingToken
      : generateToken()

    pairedByDeviceId[request.deviceId] = buildPairedEntry(request, token, nowMs)
    changedPaired = true
    approved += 1

    delete pendingById[requestId]
    changedPending = true
    removedPending += 1

    log(`auto-approved requestId=${requestId.slice(0, 12)}… deviceId=${request.deviceId.slice(0, 12)}… remoteIp=${request.remoteIp}`)
  }

  if (changedPaired) writeJsonAtomic(pairedPath, pairedByDeviceId)
  if (changedPending) writeJsonAtomic(pendingPath, pendingById)

  return { approved, removedPending, skipped, reason: 'ok' }
}

async function run() {
  if (!existsSync(gatewayDevicesDir)) {
    throw new Error(`gateway device state not found: ${gatewayDevicesDir}`)
  }

  if (!existsSync(pendingPath)) {
    writeJsonAtomic(pendingPath, {})
  }
  if (!existsSync(pairedPath)) {
    writeJsonAtomic(pairedPath, {})
  }

  if (!shouldWatch) {
    const result = sweepPendingRequests()
    log(`sweep complete: approved=${result.approved} removedPending=${result.removedPending} skipped=${result.skipped} reason=${result.reason}`)
    return
  }

  log(`watching pending requests every ${intervalMs}ms (local-dev scope only)`)
  for (;;) {
    const result = sweepPendingRequests()
    if (result.reason !== 'ok') {
      log(`sweep skipped: reason=${result.reason}`)
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

run().catch(error => {
  logError(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
