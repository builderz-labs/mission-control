/**
 * LLM output repair pipeline — MetaGPT's 4-step approach.
 *
 * LLMs frequently produce almost-correct JSON. Rather than failing
 * immediately, we try a sequence of increasingly aggressive repairs:
 *
 * 1. Extract content between [CONTENT]...[/CONTENT] tags (if present)
 * 2. Repair common JSON syntax errors (trailing commas, single quotes, etc.)
 * 3. Parse JSON
 * 4. Validate against Zod schema
 *
 * If all steps fail, throw a structured error with the original text
 * and the specific failure point for debugging.
 */

import type { ZodType } from 'zod'

export class OutputRepairError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly stage: 'extract' | 'repair' | 'parse' | 'validate',
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'OutputRepairError'
  }
}

/**
 * Step 1: Extract content from tagged regions.
 * Supports [CONTENT]...[/CONTENT], ```json...```, and ```...``` blocks.
 * Returns the original string if no tags found.
 */
export function extractTaggedContent(raw: string): string {
  // Try [CONTENT]...[/CONTENT] tags first (MetaGPT convention)
  const contentMatch = raw.match(/\[CONTENT\]([\s\S]*?)\[\/CONTENT\]/i)
  if (contentMatch) return contentMatch[1].trim()

  // Try ```json...``` blocks
  const jsonBlockMatch = raw.match(/```json\s*\n?([\s\S]*?)```/)
  if (jsonBlockMatch) return jsonBlockMatch[1].trim()

  // Try generic ``` blocks
  const codeBlockMatch = raw.match(/```\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) return codeBlockMatch[1].trim()

  // Try to find a JSON object or array directly
  const jsonObjectMatch = raw.match(/(\{[\s\S]*\})/)
  if (jsonObjectMatch) return jsonObjectMatch[1].trim()

  const jsonArrayMatch = raw.match(/(\[[\s\S]*\])/)
  if (jsonArrayMatch) return jsonArrayMatch[1].trim()

  return raw.trim()
}

/**
 * Step 2: Repair common JSON syntax errors from LLM output.
 */
export function repairJsonSyntax(text: string): string {
  let result = text

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, '$1')

  // Replace single quotes with double quotes (but not inside strings)
  // Only do this if the text doesn't already have double quotes as delimiters
  if (!result.includes('"') && result.includes("'")) {
    result = result.replace(/'/g, '"')
  }

  // Fix unquoted keys: { key: "value" } → { "key": "value" }
  result = result.replace(/(?<=\{|,)\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":')

  // Remove JavaScript-style comments
  result = result.replace(/\/\/[^\n]*/g, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')

  // Fix escaped newlines that aren't properly escaped
  result = result.replace(/(?<!\\)\n/g, '\\n')

  // Unescape the newlines we just escaped inside already-escaped strings
  // (This handles the case where the JSON is on multiple lines)
  try {
    JSON.parse(result)
    return result
  } catch {
    // If our newline escaping broke it, try without that step
    result = text
    result = result.replace(/,\s*([}\]])/g, '$1')
    if (!result.includes('"') && result.includes("'")) {
      result = result.replace(/'/g, '"')
    }
    result = result.replace(/(?<=\{|,)\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":')
    result = result.replace(/\/\/[^\n]*/g, '')
    result = result.replace(/\/\*[\s\S]*?\*\//g, '')
    return result
  }
}

/**
 * Step 3 + 4: Parse JSON and validate against Zod schema.
 *
 * @param raw - Raw LLM output string
 * @param schema - Zod schema to validate against
 * @returns Validated and typed result
 * @throws OutputRepairError with stage information on failure
 */
export function repairAndParse<T>(raw: string, schema: ZodType<T>): T {
  // Step 1: Extract tagged content
  let extracted: string
  try {
    extracted = extractTaggedContent(raw)
  } catch (err) {
    throw new OutputRepairError('Failed to extract content from LLM output', raw, 'extract', err)
  }

  // Step 2: Repair JSON syntax
  let repaired: string
  try {
    repaired = repairJsonSyntax(extracted)
  } catch (err) {
    throw new OutputRepairError('Failed to repair JSON syntax', raw, 'repair', err)
  }

  // Step 3: Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(repaired)
  } catch (err) {
    // Try one more time with the raw extracted content (maybe repair made it worse)
    try {
      parsed = JSON.parse(extracted)
    } catch {
      throw new OutputRepairError(
        `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw,
        'parse',
        err,
      )
    }
  }

  // Step 4: Validate against Zod schema
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    )
    throw new OutputRepairError(
      `Schema validation failed: ${issues.join('; ')}`,
      raw,
      'validate',
      result.error,
    )
  }

  return result.data
}

/**
 * Try to parse a plain text response as the requested type.
 * For non-JSON responses, just validate the raw string.
 */
export function parseTextResponse<T>(raw: string, schema: ZodType<T>): T {
  const result = schema.safeParse(raw.trim())
  if (!result.success) {
    throw new OutputRepairError(
      `Text validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
      raw,
      'validate',
      result.error,
    )
  }
  return result.data
}
