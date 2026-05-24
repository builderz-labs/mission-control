import * as fs from 'node:fs'
import * as path from 'node:path'

export type ContractOperation = string

export interface RouteOperation {
  method: string
  path: string
  sourceFile: string
}

export interface ParityReport {
  routeOperations: ContractOperation[]
  openapiOperations: ContractOperation[]
  missingInOpenApi: ContractOperation[]
  missingInRoutes: ContractOperation[]
  ignoredOperations: ContractOperation[]
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
const HTTP_METHODS_SET = new Set<string>(HTTP_METHODS)

function toPosix(input: string): string {
  return input.split(path.sep).join('/')
}

function normalizeSegment(segment: string): string {
  if (segment.startsWith('[[...') && segment.endsWith(']]')) {
    return `{${segment.slice(5, -2)}}`
  }
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return `{${segment.slice(4, -1)}}`
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return `{${segment.slice(1, -1)}}`
  }
  return segment
}

export function routeFileToApiPath(routeFile: string, apiRoot = 'src/app/api'): string {
  const normalizedFile = toPosix(routeFile)
  const normalizedRoot = toPosix(apiRoot)
  const routeWithoutExt = normalizedFile.replace(/\/route\.tsx?$/, '')
  const relative = routeWithoutExt.startsWith(normalizedRoot)
    ? routeWithoutExt.slice(normalizedRoot.length)
    : routeWithoutExt

  const segments = relative
    .split('/')
    .filter(Boolean)
    .map(normalizeSegment)

  return `/api${segments.length ? `/${segments.join('/')}` : ''}`
}

const HTTP_METHOD_REGEXPS = HTTP_METHODS.map((method) => ({
  method,
  constExport: new RegExp(`export\\s+const\\s+${method}\\s*=`, 'm'),
  fnExport: new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, 'm'),
}))

export function extractHttpMethods(source: string): string[] {
  const methods = new Set<string>()
  for (const { method, constExport, fnExport } of HTTP_METHOD_REGEXPS) {
    if (constExport.test(source) || fnExport.test(source)) methods.add(method)
  }
  return Array.from(methods)
}

function walkRouteFiles(dir: string, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkRouteFiles(fullPath, found)
    } else if (entry.isFile() && /route\.tsx?$/.test(entry.name)) {
      found.push(fullPath)
    }
  }
  return found
}

export function collectRouteOperations(projectRoot: string): RouteOperation[] {
  const apiRoot = path.join(projectRoot, 'src', 'app', 'api')
  const routeFiles = walkRouteFiles(apiRoot)

  const operations: RouteOperation[] = []
  for (const file of routeFiles) {
    const source = fs.readFileSync(file, 'utf8')
    const methods = extractHttpMethods(source)
    const apiPath = routeFileToApiPath(toPosix(path.relative(projectRoot, file)))
    for (const method of methods) {
      operations.push({ method, path: apiPath, sourceFile: file })
    }
  }

  return operations
}

export function collectOpenApiOperations(openapi: any): ContractOperation[] {
  const operations = new Set<ContractOperation>()
  const paths = openapi?.paths ?? {}
  for (const [rawPath, pathItem] of Object.entries(paths)) {
    const normalizedPath = String(rawPath)
    for (const method of Object.keys(pathItem as Record<string, unknown>)) {
      const upper = method.toUpperCase()
      if (HTTP_METHODS_SET.has(upper)) {
        operations.add(`${upper} ${normalizedPath}`)
      }
    }
  }
  return Array.from(operations).sort()
}

function toContractOperation(method: string, apiPath: string): ContractOperation {
  return `${method.toUpperCase()} ${apiPath}`
}

function normalizeOperation(operation: string): ContractOperation {
  const [method = '', ...pathParts] = operation.trim().split(' ')
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = pathParts.join(' ').trim()
  return `${normalizedMethod} ${normalizedPath}` as ContractOperation
}

export function compareApiContractParity(params: {
  routeOperations: RouteOperation[]
  openapiOperations: ContractOperation[]
  ignore?: string[]
}): ParityReport {
  const ignored = new Set((params.ignore ?? []).map((x) => normalizeOperation(x)))
  const routeOperations = Array.from(new Set(params.routeOperations.map((op) => toContractOperation(op.method, op.path)))).sort()
  const openapiOperations = Array.from(new Set(params.openapiOperations.map((op) => normalizeOperation(op)))).sort()

  const routeSet = new Set(routeOperations)
  const openapiSet = new Set(openapiOperations)

  const ignoredOperations: ContractOperation[] = []
  const ignoredSet = new Set<ContractOperation>()
  const missingInOpenApi: ContractOperation[] = []
  for (const op of routeOperations) {
    if (ignored.has(op)) {
      ignoredOperations.push(op)
      ignoredSet.add(op)
      continue
    }
    if (!openapiSet.has(op)) missingInOpenApi.push(op)
  }

  const missingInRoutes: ContractOperation[] = []
  for (const op of openapiOperations) {
    if (ignored.has(op)) {
      if (!ignoredSet.has(op as ContractOperation)) {
        ignoredOperations.push(op as ContractOperation)
        ignoredSet.add(op as ContractOperation)
      }
      continue
    }
    if (!routeSet.has(op)) missingInRoutes.push(op as ContractOperation)
  }

  return {
    routeOperations: routeOperations as ContractOperation[],
    openapiOperations: openapiOperations as ContractOperation[],
    missingInOpenApi,
    missingInRoutes,
    ignoredOperations: ignoredOperations.sort(),
  }
}

export function loadOpenApiFile(projectRoot: string, openapiPath = 'openapi.json'): any {
  const filePath = path.join(projectRoot, openapiPath)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function runApiContractParityCheck(params: {
  projectRoot: string
  openapiPath?: string
  ignore?: string[]
}): ParityReport {
  const projectRoot = path.resolve(params.projectRoot)
  const openapi = loadOpenApiFile(projectRoot, params.openapiPath)
  const routeOperations = collectRouteOperations(projectRoot)
  const openapiOperations = collectOpenApiOperations(openapi)
  return compareApiContractParity({ routeOperations, openapiOperations, ignore: params.ignore })
}
