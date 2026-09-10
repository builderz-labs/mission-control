import { runSafeReclaim, formatReclaimReport } from './reclaim'

async function main(): Promise<number> {
  const arg = process.argv[2] ?? '--audit'
  const mode = arg === '--auto' || arg === 'auto'
    ? 'auto'
    : arg === '--dry-run' || arg === 'dry-run'
      ? 'dry-run'
      : 'audit'
  const report = await runSafeReclaim(mode)
  process.stdout.write(`${formatReclaimReport(report)}\n`)
  return report.ok ? 0 : 1
}

void main().then((code) => {
  process.exit(code)
})
