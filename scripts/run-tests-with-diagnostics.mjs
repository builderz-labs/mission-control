import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const report = path.join(tmpdir(), `mission-control-vitest-${randomUUID()}.json`)
const result = spawnSync('pnpm', [
  'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${report}`,
], { stdio: 'ignore' })

try {
  const data = JSON.parse(readFileSync(report, 'utf8'))
  const failed = data.testResults.flatMap(file => file.assertionResults)
    .filter(test => test.status === 'failed')
    .map(test => test.fullName)
    .slice(0, 12)
  if (result.status === 0) {
    console.log(`Unit tests passed (${data.numPassedTests}/${data.numTotalTests})`)
  } else {
    console.error(`error: Unit tests failed: ${failed.join(' | ') || 'unknown test'}`)
  }
} catch {
  console.error('error: Unit tests failed before a JSON report was produced')
} finally {
  rmSync(report, { force: true })
}

process.exit(result.status ?? 1)
