/**
 * Frontmatter schema extraction and validation.
 *
 * Reads a `_schema:` block from YAML frontmatter and validates that all
 * required fields declared in it are present in the same frontmatter.
 */

export interface SchemaBlock {
  type: string
  required?: string[]
  optional?: string[]
  [key: string]: unknown
}

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  schema: SchemaBlock | null
}

/**
 * Extract a _schema YAML block from markdown frontmatter.
 * Expects format:
 * ```
 * ---
 * _schema:
 *   type: note
 *   required: [title, tags]
 *   optional: [source]
 * ---
 * ```
 */
export function extractSchema(content: string): SchemaBlock | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null

  const fm = fmMatch[1]
  const schemaMatch = fm.match(/_schema:\s*\n((?:\s{2,}.+\n?)*)/)
  if (!schemaMatch) return null

  const block = schemaMatch[1]
  const schema: SchemaBlock = { type: 'unknown' }

  const typeMatch = block.match(/type:\s*(.+)/)
  if (typeMatch) schema.type = typeMatch[1].trim()

  const requiredMatch = block.match(/required:\s*\[([^\]]*)\]/)
  if (requiredMatch) {
    schema.required = requiredMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
  }

  const optionalMatch = block.match(/optional:\s*\[([^\]]*)\]/)
  if (optionalMatch) {
    schema.optional = optionalMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
  }

  return schema
}

/**
 * Validate frontmatter fields against a _schema block.
 */
export function validateSchema(content: string): SchemaValidationResult {
  const schema = extractSchema(content)
  if (!schema) return { valid: true, errors: [], schema: null }

  const errors: string[] = []
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) {
    return { valid: false, errors: ['No frontmatter found but _schema declared'], schema }
  }

  const fm = fmMatch[1]
  const fields = new Set<string>()
  for (const line of fm.split('\n')) {
    const fieldMatch = line.match(/^(\w[\w-]*):\s*/)
    if (fieldMatch) fields.add(fieldMatch[1])
  }

  if (schema.required) {
    for (const field of schema.required) {
      if (!fields.has(field)) {
        errors.push(`Missing required field: ${field}`)
      }
    }
  }

  return { valid: errors.length === 0, errors, schema }
}
