#!/usr/bin/env node
/**
 * Adds the creative-CMS routes (branding, assets, context) to openapi.json so
 * the contract-parity check passes and downstream codegen tools see them.
 *
 * Surgical: inserts new keys at the end of `paths` and `components.schemas`
 * without re-serializing the existing file content. The diff against HEAD
 * contains only the lines we add, not whole-file reformatting.
 *
 * Idempotent: if any of the new keys already exist, this overwrites just
 * that key's block.
 *
 * Usage:  node scripts/add-creative-cms-openapi.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const OPENAPI_PATH = path.resolve('openapi.json')
const raw = fs.readFileSync(OPENAPI_PATH, 'utf8')
const hadCrlf = raw.includes('\r\n')
// Operate on LF internally; convert back at the end if the source was CRLF.
const lf = raw.replace(/\r\n/g, '\n')

// ---- Definitions ---------------------------------------------------------

const ASSET_TYPE_ENUM = [
  'image',
  'video',
  'audio',
  'document',
  'raw',
  'character_sheet',
  'reference',
  'deliverable',
]

const ENTRY_TYPE_ENUM = [
  'brief',
  'research',
  'decision',
  'meeting',
  'asset_note',
  'agent_log',
  'client_feedback',
  'milestone',
  'brand_note',
]

const newSchemas = {
  BrandingProfile: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      project_id: { type: 'integer' },
      workspace_id: { type: 'integer' },
      brand_name: { type: 'string' },
      primary_color: { type: 'string', description: 'Hex color (#RRGGBB) or null' },
      secondary_color: { type: 'string', description: 'Hex color (#RRGGBB) or null' },
      accent_colors: { type: 'array', items: { type: 'string' } },
      heading_font: { type: 'string' },
      body_font: { type: 'string' },
      approved_fonts: { type: 'array', items: { type: 'string' } },
      logo_asset_id: { type: 'integer', description: 'project_assets.id of the active logo, or null' },
      brand_notes: { type: 'string' },
      tone_notes: { type: 'string' },
      created_at: { type: 'integer' },
      updated_at: { type: 'integer' },
    },
  },
  Asset: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      project_id: { type: 'integer' },
      workspace_id: { type: 'integer' },
      cloudinary_public_id: { type: 'string' },
      cloudinary_url: { type: 'string' },
      asset_type: { type: 'string', enum: ASSET_TYPE_ENUM },
      asset_category: { type: 'string' },
      original_filename: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object', additionalProperties: true },
      uploaded_by: { type: 'string', description: 'Username of the user/agent that recorded the upload' },
      created_at: { type: 'integer' },
      updated_at: { type: 'integer' },
    },
  },
  ContextEntry: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      project_id: { type: 'integer' },
      workspace_id: { type: 'integer' },
      entry_type: { type: 'string', enum: ENTRY_TYPE_ENUM },
      title: { type: 'string' },
      content: { type: 'string' },
      source: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      created_by: { type: 'string' },
      created_at: { type: 'integer' },
      updated_at: { type: 'integer' },
    },
  },
  SignedUploadPayload: {
    type: 'object',
    properties: {
      cloud_name: { type: 'string' },
      api_key: { type: 'string' },
      resource_type: { type: 'string', enum: ['image', 'video', 'raw'] },
      upload_url: { type: 'string', description: 'Cloudinary endpoint to POST the file + signed params to' },
      signature: { type: 'string' },
      timestamp: { type: 'integer' },
      folder: { type: 'string' },
      public_id: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      context: { type: 'object', additionalProperties: { type: 'string' } },
    },
  },
}

const projectIdParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'integer' },
  description: 'Project id',
}

const errorResponses = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
  404: { $ref: '#/components/responses/NotFound' },
  429: { $ref: '#/components/responses/RateLimited' },
}

function single(key, ref) {
  return {
    content: {
      'application/json': {
        schema: { type: 'object', properties: { [key]: { $ref: ref } } },
      },
    },
  }
}

function paged(key, ref) {
  return {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            [key]: { type: 'array', items: { $ref: ref } },
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
      },
    },
  }
}

const newPaths = {
  '/api/projects/{id}/branding': {
    get: {
      tags: ['Projects'],
      summary: "Fetch a project's branding profile",
      operationId: 'getProjectBranding',
      parameters: [projectIdParam],
      responses: {
        200: { description: 'Branding profile', ...single('branding', '#/components/schemas/BrandingProfile') },
        ...errorResponses,
      },
    },
    post: {
      tags: ['Projects'],
      summary: "Create or replace a project's branding profile (upsert)",
      operationId: 'upsertProjectBranding',
      parameters: [projectIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                brand_name: { type: 'string' },
                primary_color: { type: 'string', description: 'Hex color (#RRGGBB / #RGB / #RRGGBBAA)' },
                secondary_color: { type: 'string' },
                accent_colors: { type: 'array', items: { type: 'string' } },
                heading_font: { type: 'string' },
                body_font: { type: 'string' },
                approved_fonts: { type: 'array', items: { type: 'string' } },
                brand_notes: { type: 'string' },
                tone_notes: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Branding profile (existing, updated)', ...single('branding', '#/components/schemas/BrandingProfile') },
        201: { description: 'Branding profile (newly created)', ...single('branding', '#/components/schemas/BrandingProfile') },
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Projects'],
      summary: 'Patch fields on an existing branding profile',
      operationId: 'patchProjectBranding',
      parameters: [projectIdParam],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
      responses: {
        200: { description: 'Branding profile (patched)', ...single('branding', '#/components/schemas/BrandingProfile') },
        ...errorResponses,
      },
    },
  },
  '/api/projects/{id}/branding/logo': {
    post: {
      tags: ['Projects'],
      summary: 'Upload a logo PNG (multipart). Server validates PNG alpha channel before uploading to Cloudinary.',
      operationId: 'uploadProjectLogo',
      parameters: [projectIdParam],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary', description: 'PNG file with alpha channel (color type 4 or 6)' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Asset record and updated branding profile',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  asset: { $ref: '#/components/schemas/Asset' },
                  branding: {
                    type: 'object',
                    properties: {
                      project_id: { type: 'integer' },
                      logo_asset_id: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        ...errorResponses,
        415: { description: 'Unsupported media type (not multipart/form-data)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        503: { description: 'Cloudinary not configured on the server', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/api/projects/{id}/assets': {
    get: {
      tags: ['Projects'],
      summary: "List a project's assets (paginated, filterable by asset_type and tag)",
      operationId: 'listProjectAssets',
      parameters: [
        projectIdParam,
        { name: 'asset_type', in: 'query', required: false, schema: { type: 'string', enum: ASSET_TYPE_ENUM } },
        { name: 'tag', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200 } },
      ],
      responses: {
        200: { description: 'Page of assets', ...paged('assets', '#/components/schemas/Asset') },
        ...errorResponses,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Record an asset already uploaded to Cloudinary (called after a signed-upload POST)',
      operationId: 'recordProjectAsset',
      parameters: [projectIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['cloudinary_public_id', 'cloudinary_url', 'asset_type'],
              properties: {
                cloudinary_public_id: { type: 'string' },
                cloudinary_url: { type: 'string' },
                asset_type: { type: 'string', enum: ASSET_TYPE_ENUM },
                asset_category: { type: 'string' },
                original_filename: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                metadata: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Recorded asset', ...single('asset', '#/components/schemas/Asset') },
        409: { description: 'An asset with this cloudinary_public_id already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ...errorResponses,
      },
    },
  },
  '/api/projects/{id}/assets/sign': {
    post: {
      tags: ['Projects'],
      summary: 'Mint a signed-upload payload for direct-to-Cloudinary upload',
      description:
        'Returns the params + signature the frontend POSTs alongside the file to https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/upload. The VPS never sees the file bytes; api_secret is never sent. After upload, the frontend records the asset via POST /api/projects/{id}/assets.',
      operationId: 'signProjectAssetUpload',
      parameters: [projectIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['asset_type'],
              properties: {
                asset_type: { type: 'string', enum: ASSET_TYPE_ENUM },
                asset_category: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Signed upload payload', content: { 'application/json': { schema: { $ref: '#/components/schemas/SignedUploadPayload' } } } },
        503: { description: 'Cloudinary not configured on the server', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ...errorResponses,
      },
    },
  },
  '/api/projects/{id}/assets/{assetId}': {
    delete: {
      tags: ['Projects'],
      summary: 'Delete an asset row. Also clears logo_asset_id on any branding profile that referenced it.',
      operationId: 'deleteProjectAsset',
      parameters: [
        projectIdParam,
        { name: 'assetId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        200: {
          description: 'Tombstone',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'integer' }, deleted: { type: 'boolean' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
  '/api/projects/{id}/context': {
    get: {
      tags: ['Projects'],
      summary: "List a project's context entries (paginated, filterable by entry_type)",
      operationId: 'listProjectContext',
      parameters: [
        projectIdParam,
        { name: 'entry_type', in: 'query', required: false, schema: { type: 'string', enum: ENTRY_TYPE_ENUM } },
        { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200 } },
      ],
      responses: {
        200: { description: 'Page of context entries', ...paged('entries', '#/components/schemas/ContextEntry') },
        ...errorResponses,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Append a context entry to a project',
      operationId: 'createProjectContextEntry',
      parameters: [projectIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['entry_type', 'title'],
              properties: {
                entry_type: { type: 'string', enum: ENTRY_TYPE_ENUM },
                title: { type: 'string' },
                content: { type: 'string' },
                source: { type: 'string' },
                metadata: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Created context entry', ...single('entry', '#/components/schemas/ContextEntry') },
        ...errorResponses,
      },
    },
  },
  '/api/projects/{id}/context/{entryId}': {
    delete: {
      tags: ['Projects'],
      summary: 'Delete a context entry. Requires admin role.',
      operationId: 'deleteProjectContextEntry',
      parameters: [
        projectIdParam,
        { name: 'entryId', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        200: {
          description: 'Tombstone',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'integer' }, deleted: { type: 'boolean' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
}

// ---- JSON pretty-printer (only used for the new content) -----------------

const MAX_INLINE = 110

function fmt(value, indent = 0, prefixLen = 0) {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)

  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const inline = `[${value.map(inlineOf).join(', ')}]`
    if (prefixLen + inline.length <= MAX_INLINE) return inline
    return `[\n${value.map((v) => padIn + fmt(v, indent + 1, padIn.length)).join(',\n')}\n${pad}]`
  }

  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const inline = `{ ${keys.map((k) => `${JSON.stringify(k)}: ${inlineOf(value[k])}`).join(', ')} }`
  if (prefixLen + inline.length <= MAX_INLINE && depth(value) <= 1) return inline
  const lines = keys.map((k) => {
    const p = `${padIn}${JSON.stringify(k)}: `
    return p + fmt(value[k], indent + 1, p.length)
  })
  return `{\n${lines.join(',\n')}\n${pad}}`
}

function inlineOf(value) {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(inlineOf).join(', ')}]`
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${inlineOf(value[k])}`).join(', ')} }`
}

function depth(value) {
  if (value === null || typeof value !== 'object') return 0
  const children = Array.isArray(value) ? value : Object.values(value)
  let max = 0
  for (const c of children) max = Math.max(max, depth(c))
  return 1 + max
}

// ---- String-level surgical insertion -------------------------------------

function findKeyValueRange(src, keyName, fromIdx = 0) {
  // Locates `"keyName": {` and returns { openIdx, closeIdx } of the matching braces.
  const needle = `"${keyName}":`
  let i = src.indexOf(needle, fromIdx)
  if (i === -1) return null
  // Find the next `{` after the colon
  while (i < src.length && src[i] !== '{') i++
  if (i === src.length) return null
  return { openIdx: i, closeIdx: findMatchingBrace(src, i) }
}

function findMatchingBrace(src, openIdx) {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

function insertIntoObject(src, range, entries, indentChars) {
  // Idempotency: strip any existing block for each new key, BUT only inside
  // this exact object range — `findKeyValueRange` is greedy from `fromIdx`.
  let s = src
  for (const key of Object.keys(entries)) {
    const innerRange = findKeyValueRange(s.slice(range.openIdx, range.closeIdx + 1), key)
    if (!innerRange) continue
    const absOpen = range.openIdx + innerRange.openIdx
    const absClose = range.openIdx + innerRange.closeIdx
    // Find the start of the key declaration line (find preceding `"key":`)
    // and the trailing comma if any.
    const keyDecl = s.lastIndexOf(`"${key}":`, absOpen)
    if (keyDecl === -1 || keyDecl < range.openIdx) continue
    // Walk back to start of the line (just past the previous newline).
    let lineStart = s.lastIndexOf('\n', keyDecl) + 1
    // Walk forward past closing brace + optional comma + optional trailing newline.
    let end = absClose + 1
    if (s[end] === ',') end++
    if (s[end] === '\n') end++
    // Adjust: if removing leaves a stranded leading newline, fold it.
    s = s.slice(0, lineStart) + s.slice(end)
    range = { openIdx: range.openIdx, closeIdx: findMatchingBrace(s, range.openIdx) }
  }

  // Render new entries with the correct indent.
  const entryStrings = []
  for (const [key, value] of Object.entries(entries)) {
    const prefix = `${indentChars}${JSON.stringify(key)}: `
    entryStrings.push(prefix + fmt(value, indentChars.length / 2, prefix.length))
  }
  const block = entryStrings.join(',\n')

  // Insert before the closing brace. Need to decide on comma/newline placement
  // depending on whether the existing object is empty or not.
  const inside = s.slice(range.openIdx + 1, range.closeIdx)
  const hasExistingContent = /[^\s]/.test(inside)
  let insertion
  if (hasExistingContent) {
    // Make sure to add a leading `,\n` so we don't collide with the last entry,
    // and trim any trailing whitespace before the closing brace.
    let cut = range.closeIdx
    while (cut > 0 && /\s/.test(s[cut - 1])) cut--
    insertion = `,\n${block}\n${indentChars.slice(0, -2)}`
    return s.slice(0, cut) + insertion + s.slice(cut)
  } else {
    insertion = `\n${block}\n${indentChars.slice(0, -2)}`
    return s.slice(0, range.openIdx + 1) + insertion + s.slice(range.closeIdx)
  }
}

// ---- Run ------------------------------------------------------------------

let s = lf

// 1) Insert new path keys into `paths`
let pathsRange = findKeyValueRange(s, 'paths')
if (!pathsRange) throw new Error('could not locate "paths" key in openapi.json')
s = insertIntoObject(s, pathsRange, newPaths, '    ') // path entries are at indent 4

// 2) Insert new schemas into `components.schemas`
const componentsRange = findKeyValueRange(s, 'components')
if (!componentsRange) throw new Error('could not locate "components" key in openapi.json')
// Find the inner schemas block within components
const componentsBlock = s.slice(componentsRange.openIdx, componentsRange.closeIdx + 1)
const innerSchemas = findKeyValueRange(componentsBlock, 'schemas')
if (!innerSchemas) throw new Error('could not locate "components.schemas" in openapi.json')
const schemasRange = {
  openIdx: componentsRange.openIdx + innerSchemas.openIdx,
  closeIdx: componentsRange.openIdx + innerSchemas.closeIdx,
}
s = insertIntoObject(s, schemasRange, newSchemas, '    ') // schemas are at indent 4

// Restore CRLF if the source used it
if (hadCrlf) s = s.replace(/\r?\n/g, '\r\n')
fs.writeFileSync(OPENAPI_PATH, s, 'utf8')

process.stdout.write(`Wrote ${OPENAPI_PATH}\n`)
process.stdout.write(`  paths added/updated:   ${Object.keys(newPaths).length}\n`)
process.stdout.write(`  operations added:      ${Object.values(newPaths).reduce((n, ops) => n + Object.keys(ops).length, 0)}\n`)
process.stdout.write(`  component schemas:     ${Object.keys(newSchemas).join(', ')}\n`)
