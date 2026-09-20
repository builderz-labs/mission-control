import { NextResponse } from 'next/server'
import { jevAssistantRequestSchema, type JevAssistantRequest } from '@/lib/jev-assistant-schema'

const MAX_BYTES = 80_000
const MAX_DEPTH = 40

function exceedsJsonDepth(text: string): boolean {
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
      if (depth > MAX_DEPTH) return true
    } else if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
  return false
}

function error(message: string, details?: string[]): NextResponse {
  return NextResponse.json(
    details ? { error: message, details } : { error: message },
    { status: 400 },
  )
}

export async function validateJevAssistantRequest(
  request: Request,
): Promise<{ data: JevAssistantRequest } | { error: NextResponse }> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return { error: error('Assistant request exceeds the 80 KB limit') }
  }
  let text: string
  try {
    text = await request.text()
  } catch {
    return { error: error('Invalid request body') }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { error: error('Assistant request exceeds the 80 KB limit') }
  }
  if (exceedsJsonDepth(text)) {
    return { error: error('Assistant request exceeds the nesting limit') }
  }
  try {
    const parsed = jevAssistantRequestSchema.safeParse(JSON.parse(text))
    if (parsed.success) return { data: parsed.data }
    return {
      error: error('Validation failed', parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      )),
    }
  } catch {
    return { error: error('Invalid request body') }
  }
}
