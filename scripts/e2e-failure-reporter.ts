import path from 'node:path'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/** Keep remote failure summaries useful without copying page content or credentials. */
export default class FailureReporter implements Reporter {
  private failures: string[] = []

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === test.expectedStatus || result.status === 'skipped') return
    const location = result.errors.find((error) => error.location)?.location ?? test.location
    const step = result.steps.flatMap((entry) => [entry, ...entry.steps]).findLast((entry) => entry.error)
    this.failures.push(`${path.basename(location.file)}:${location.line} ${test.title} [${step?.title ?? result.status}]`)
  }

  onEnd() {
    for (const failure of this.failures) console.error(`Error: Browser regression: ${failure.slice(0, 280)}`)
  }
}
