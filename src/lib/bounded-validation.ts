import { NextResponse } from 'next/server'
import type { ZodSchema } from 'zod'

interface Bounds {
  maxBytes: number
  maxDepth: number
  label: string
}

function exceedsDepth(text: string, maximum: number): boolean {
  let depth = 0
  let quoted = false
  let escaped = false
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{' || character === '[') {
      depth += 1
      if (depth > maximum) return true
    } else if (character === '}' || character === ']') depth = Math.max(0, depth - 1)
  }
  return false
}

function error(message: string, details?: string[]) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status: 400 })
}

export async function validateBoundedBody<T>(
  request: Request,
  schema: ZodSchema<T>,
  bounds: Bounds,
): Promise<{ data: T } | { error: NextResponse }> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > bounds.maxBytes) {
    return { error: error(`${bounds.label} exceeds the size limit`) }
  }
  let text: string
  try {
    text = await request.text()
  } catch {
    return { error: error('Invalid request body') }
  }
  if (Buffer.byteLength(text, 'utf8') > bounds.maxBytes) {
    return { error: error(`${bounds.label} exceeds the size limit`) }
  }
  if (exceedsDepth(text, bounds.maxDepth)) {
    return { error: error(`${bounds.label} exceeds the nesting limit`) }
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    if (parsed.success) return { data: parsed.data }
    return { error: error('Validation failed', parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    )) }
  } catch {
    return { error: error('Invalid request body') }
  }
}
