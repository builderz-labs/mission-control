'use strict'

const MIN_COMMAND_TIMEOUT_MS = 1000
const MAX_COMMAND_TIMEOUT_MS = 120000
const DEFAULT_COMMAND_TIMEOUT_MS = 10000
const IDLE_SOCKET_TIMEOUT_MS = 15000
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_CONNECTIONS = 32

function normalizeTimeoutMs(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_COMMAND_TIMEOUT_MS
  return Math.min(
    MAX_COMMAND_TIMEOUT_MS,
    Math.max(MIN_COMMAND_TIMEOUT_MS, Math.trunc(parsed)),
  )
}

function appendBounded(current, chunk, maxBytes = MAX_OUTPUT_BYTES) {
  const currentBuffer = Buffer.from(String(current), 'utf8')
  const remaining = Math.max(0, maxBytes - currentBuffer.length)
  const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
  let accepted = chunkBuffer.subarray(0, remaining).toString('utf8')

  while (Buffer.byteLength(accepted, 'utf8') > remaining) {
    accepted = accepted.slice(0, -1)
  }

  return {
    value: currentBuffer.toString('utf8') + accepted,
    exceeded: chunkBuffer.length > remaining,
  }
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  IDLE_SOCKET_TIMEOUT_MS,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_CONNECTIONS,
  MAX_OUTPUT_BYTES,
  MAX_REQUEST_BYTES,
  MIN_COMMAND_TIMEOUT_MS,
  appendBounded,
  normalizeTimeoutMs,
}
