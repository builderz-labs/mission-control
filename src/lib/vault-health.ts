import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export interface HealthCategory {
  name: string
  status: 'healthy' | 'warning' | 'critical'
  score: number
  issues: string[]
  suggestions: string[]
}

export function parseWikiDoctorOutput(output: string): HealthCategory {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const issues = lines.filter((line) => line.startsWith('fail') || line.startsWith('error'))
  const ok = lines.some((line) => /^doctor:\s*OK$/i.test(line)) && issues.length === 0
  return {
    name: 'Omnia Vault doctor',
    status: ok ? 'healthy' : issues.length ? 'critical' : 'warning',
    score: ok ? 100 : issues.length ? 30 : 60,
    issues: issues.slice(0, 10),
    suggestions: ok ? [] : ['Run python3 scripts/wiki_tool.py doctor from ~/Dev/omnia-vault'],
  }
}

async function execDoctor(vaultRoot: string) {
  const script = join(vaultRoot, 'scripts', 'wiki_tool.py')
  return execFileAsync('python3', [script, 'doctor'], {
    timeout: 12_000,
    cwd: vaultRoot,
  })
}

export async function runVaultWikiDoctor(vaultRoot: string): Promise<HealthCategory> {
  try {
    const { stdout, stderr } = await execDoctor(vaultRoot)
    return parseWikiDoctorOutput(`${stdout}\n${stderr}`)
  } catch (first) {
    try {
      const { stdout, stderr } = await execDoctor(vaultRoot)
      return parseWikiDoctorOutput(`${stdout}\n${stderr}`)
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string }
      const output = `${err.stdout || ''}\n${err.stderr || ''}`
      if (output.trim()) return parseWikiDoctorOutput(output)
      return {
        name: 'Omnia Vault doctor',
        status: 'warning',
        score: 50,
        issues: [err.message || 'wiki doctor failed'],
        suggestions: ['Install Python 3 and rerun wiki_tool.py doctor'],
      }
    }
  }
}
