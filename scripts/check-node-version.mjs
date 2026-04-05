#!/usr/bin/env node

// Vercel manages Node.js version via project settings — skip check there
if (process.env.VERCEL) process.exit(0)

const MIN_NODE_MAJOR = 22

const current = process.versions.node
const currentMajor = Number.parseInt(current.split('.')[0] || '', 10)

if (!Number.isFinite(currentMajor)) {
  console.error(`error: Unable to parse current Node version: ${current}`)
  process.exit(1)
}

// Floor check only: allow all future Node majors as long as they are >= 22.
if (currentMajor < MIN_NODE_MAJOR) {
  console.error(
    [
      `error: Mission Control requires Node >= ${MIN_NODE_MAJOR}, but found ${current}.`,
      'Any newer Node version is supported. Try `nvm use 22` (recommended LTS) or `nvm install --lts && nvm use --lts`.',
    ].join('\n')
  )
  process.exit(1)
}
