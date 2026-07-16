import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflows = [
  'star-chart.yml',
  'scorecard.yml',
  'quality-gate.yml',
  'osv-scanner.yml',
  'docker-publish.yml',
  'codeql.yml',
]

function readWorkflow(name: string): string {
  return readFileSync(join(process.cwd(), '.github/workflows', name), 'utf8')
}

function topLevelPermissions(source: string): string {
  const match = source.match(/^permissions:\n((?: {2}\S.*\n?)*)/m)
  return match?.[1] ?? ''
}

describe('workflow token permission boundaries', () => {
  it.each(workflows)('%s has no workflow-level write scope', (workflow) => {
    const permissions = topLevelPermissions(readWorkflow(workflow))
    expect(permissions).toContain('contents: read')
    expect(permissions).not.toContain(': write')
  })

  it('grants chart commits only to the refresh job', () => {
    expect(readWorkflow('star-chart.yml')).toMatch(
      /refresh:\n {4}runs-on: ubuntu-latest\n {4}permissions:\n {6}contents: write/,
    )
  })

  it.each(['scorecard.yml', 'osv-scanner.yml', 'codeql.yml'])(
    'grants SARIF upload only inside the scanner job in %s',
    (workflow) => {
      expect(readWorkflow(workflow)).toMatch(
        /jobs:\n(?:.|\n)*? {4}permissions:\n(?: {6}.+\n)*? {6}security-events: write/,
      )
    },
  )

  it('grants package publication only to the Docker publish job', () => {
    expect(readWorkflow('docker-publish.yml')).toMatch(
      /publish:\n {4}runs-on: ubuntu-latest\n {4}permissions:\n {6}contents: read\n {6}packages: write/,
    )
  })

  it('keeps the quality gate read-only', () => {
    expect(readWorkflow('quality-gate.yml')).not.toContain(': write')
  })
})
