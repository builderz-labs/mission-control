/**
 * Parse JSON with tolerant fallback for JSONC/JSON5-style inputs.
 * Supports comments, trailing commas, and unquoted keys.
 */
export function parseJsonRelaxed<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    const stripped = stripJsonComments(raw)
    const normalized = removeTrailingCommas(stripped)
    try {
      return JSON.parse(normalized) as T
    } catch {
      // Last resort: quote unquoted keys (JSON5-style configs like OpenClaw)
      const quoted = quoteUnquotedKeys(normalized)
      return JSON.parse(quoted) as T
    }
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

/**
 * Quote unquoted object keys for JSON5-style inputs (e.g. `{ agents: { ... } }`).
 * Carefully avoids modifying content inside strings.
 */
function quoteUnquotedKeys(input: string): string {
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

    // Detect unquoted key: identifier chars followed by optional whitespace then ':'
    if (/[a-zA-Z_$]/.test(current)) {
      let j = i
      while (j < input.length && /[\w$]/.test(input[j])) j++
      const word = input.slice(i, j)
      // Skip whitespace after the word
      let k = j
      while (k < input.length && /\s/.test(input[k])) k++
      if (k < input.length && input[k] === ':') {
        // Check the preceding non-whitespace character to confirm this is a key position
        let p = i - 1
        while (p >= 0 && /\s/.test(input[p])) p--
        if (p < 0 || input[p] === '{' || input[p] === ',') {
          output += `"${word}"`
          i = j - 1
          continue
        }
      }
      output += current
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
