import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const registryPath = path.join(root, 'marcuzx-forge', 'registry', 'projects.json')
const modulesPath = path.join(root, 'marcuzx-forge', 'registry', 'modules.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

const projects = readJson(registryPath)
const modules = readJson(modulesPath)

const lines = [
  'Marcuzx Forge Control Snapshot',
  '================================',
  '',
  `Projects registered: ${projects.length}`,
  `Modules initialized: ${modules.length}`,
  '',
  'Projects:',
  ...projects.map((project) => `- ${project.projectName} [${project.status}] -> ${project.path}`),
  '',
  'Modules:',
  ...modules.map((module) => `- ${module.name} -> ${module.uiRoute}`),
]

process.stdout.write(`${lines.join('\n')}\n`)
