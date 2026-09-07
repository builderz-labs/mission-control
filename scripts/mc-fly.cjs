#!/usr/bin/env node
const fs = require('node:fs')
const { handleMessage } = require('./mc-mcp-server.cjs')
const names = { status: 'mc_fly_status', submit: 'mc_submit_fly_leaf', cancel: 'mc_cancel_fly_leaf' }

async function runFlyCli(argv, call = handleMessage) {
  const [action, file, ...extra] = argv
  if (!names[action] || extra.length || (action !== 'status' && !file)) {
    throw new Error('Usage: node scripts/mc-fly.cjs status [payload.json] | submit payload.json | cancel payload.json')
  }
  let args = {}
  if (file) {
    if (fs.statSync(file).size > 65536) throw new Error('Payload exceeds 64 KiB')
    args = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Payload must be a JSON object')
  }
  const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: names[action], arguments: args } })
  const text = response?.result?.content?.[0]?.text
  if (response?.error || response?.result?.isError || typeof text !== 'string') {
    throw new Error(response?.result?.isError ? text : 'Mission Control response is invalid; ownership remains unconfirmed')
  }
  return JSON.parse(text)
}
if (require.main === module) {
  runFlyCli(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => {
    console.error(JSON.stringify({ error: error.message, safe_local_fallback: false })); process.exitCode = 1
  })
}
module.exports = { runFlyCli }
