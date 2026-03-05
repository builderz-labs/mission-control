/**
 * Parse JSON with tolerant fallback for JSONC-style inputs.
 * Supports comments and trailing commas, then validates with JSON.parse.
 */
export function parseJsonRelaxed<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    const stripped = stripJsonComments(raw)
    const normalized = removeTrailingCommas(stripped)
    return JSON.parse(normalized) as T
  }
}

function stripJsonComments(input: string): string {
  let output = ''
  let inString = false
  let stringDelimiter = '"'
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < input.length; i++) {
    const current = input[i]
    const next = i + 1 < input.length ? input[i + 1] : ''
    const prev = i > 0 ? input[i - 1] : ''

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false
        output += current
      }
      continue
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (inString) {
      output += current
      if (current === stringDelimiter && prev !== '\\') {
        inString = false
      }
      continue
    }

    if ((current === '"' || current === "'") && prev !== '\\') {
      inString = true
      stringDelimiter = current
      output += current
      continue
    }

    if (current === '/' && next === '/') {
      inLineComment = true
      i += 1
      continue
    }

    if (current === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }

    output += current
  }

  return output
}

function removeTrailingCommas(input: string): string {
  let output = ''
  let inString = false
  let stringDelimiter = '"'

  for (let i = 0; i < input.length; i++) {
    const current = input[i]
    const prev = i > 0 ? input[i - 1] : ''

    if (inString) {
      output += current
      if (current === stringDelimiter && prev !== '\\') {
        inString = false
      }
      continue
    }

    if ((current === '"' || current === "'") && prev !== '\\') {
      inString = true
      stringDelimiter = current
      output += current
      continue
    }

    if (current === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j += 1
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        continue
      }
    }

    output += current
  }

  return output
}
