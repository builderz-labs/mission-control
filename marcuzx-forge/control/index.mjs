import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const registryPath = path.join(root, 'marcuzx-forge', 'registry', 'projects.json')
const registryYamlPath = path.join(root, 'marcuzx-forge', 'registry', 'projects.yaml')
const modulesPath = path.join(root, 'marcuzx-forge', 'registry', 'modules.json')
const scanPath = path.join(root, 'marcuzx-forge', 'registry', 'workspace-scan.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

const projects = readJson(registryPath)
const modules = readJson(modulesPath)
const scan = readJson(scanPath)

const countStatus = (items, status) => items.filter((item) => item.status === status).length

const lines = [
  'Marcuzx Forge Control Snapshot',
  '================================',
  '',
  `Projects registered: ${projects.length}`,
  `Modules initialized: ${modules.length}`,
  `Registry YAML: ${fs.existsSync(registryYamlPath) ? 'present' : 'missing'}`,
  '',
  'Workspace scan:',
  `- FOUND: ${countStatus(scan.modules, 'FOUND') + countStatus(scan.assets, 'FOUND')}`,
  `- PARTIAL: ${countStatus(scan.modules, 'PARTIAL') + countStatus(scan.assets, 'PARTIAL')}`,
  `- MISSING: ${countStatus(scan.modules, 'MISSING') + countStatus(scan.assets, 'MISSING')}`,
  '',
  'Projects:',
  ...projects.map((project) => `- ${project.projectName} [${project.status}] -> ${project.path}`),
  '',
  'Modules:',
  ...modules.map((module) => `- ${module.name} -> ${module.uiRoute}`),
]

process.stdout.write(`${lines.join('\n')}\n`)
