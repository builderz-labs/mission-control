#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: pnpm csp:hash <file-path> | --text "..."')
  process.exit(1)
}

let source

if (args[0] === '--text') {
  source = args.slice(1).join(' ')
  if (!source) {
    console.error('Missing inline text after --text')
    process.exit(1)
  }
} else {
  const filePath = path.resolve(process.cwd(), args[0])
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }
  source = fs.readFileSync(filePath, 'utf8')
}

const hash = crypto.createHash('sha256').update(source, 'utf8').digest('base64')
console.log(`sha256-${hash}`)
