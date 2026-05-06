// Mission Control Windows launcher.
// Loads .env from the install root, applies sensible defaults, and starts
// the Next.js standalone server. Invoked by Start.bat, install.ps1, or the
// scheduled task registered by install.ps1.

'use strict'

const fs = require('fs')
const path = require('path')

const installRoot = __dirname
const appRoot = path.join(installRoot, 'app')
const envPath = path.join(installRoot, '.env')
const serverEntry = path.join(appRoot, 'server.js')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(envPath)

if (!process.env.MISSION_CONTROL_DATA_DIR) {
  process.env.MISSION_CONTROL_DATA_DIR = path.join(installRoot, 'data')
}
fs.mkdirSync(process.env.MISSION_CONTROL_DATA_DIR, { recursive: true })

if (!process.env.HOSTNAME) process.env.HOSTNAME = '127.0.0.1'
if (!process.env.PORT) process.env.PORT = '3000'

if (!fs.existsSync(serverEntry)) {
  console.error(`[launcher] server.js not found at ${serverEntry}`)
  process.exit(1)
}

process.chdir(appRoot)
require(serverEntry)
