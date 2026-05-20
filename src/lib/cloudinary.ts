import { v2 as cloudinary } from 'cloudinary'

/**
 * Cloudinary helper for the creative-CMS routes.
 *
 * Credentials live in env (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 * CLOUDINARY_API_SECRET). Configuration is lazy so missing creds only error
 * when an upload route is actually called.
 */

export type CreativeAssetType =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'raw'
  | 'character_sheet'
  | 'reference'
  | 'deliverable'

export const CREATIVE_ASSET_TYPES: CreativeAssetType[] = [
  'image',
  'video',
  'audio',
  'document',
  'raw',
  'character_sheet',
  'reference',
  'deliverable',
]

const ASSET_TYPE_FOLDER: Record<CreativeAssetType, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio',
  document: 'documents',
  raw: 'raw',
  character_sheet: 'character-sheets',
  reference: 'raw',
  deliverable: 'deliverables',
}

const ASSET_TYPE_RESOURCE: Record<CreativeAssetType, 'image' | 'video' | 'raw'> = {
  image: 'image',
  video: 'video',
  audio: 'video', // Cloudinary serves audio under the video resource type.
  document: 'raw',
  raw: 'raw',
  character_sheet: 'image',
  reference: 'raw',
  deliverable: 'raw',
}

export class CloudinaryNotConfiguredError extends Error {
  status = 503
  constructor() {
    super(
      'Cloudinary credentials are not set on this server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    )
  }
}

let configured = false

function ensureConfigured(): { cloudName: string; apiKey: string; apiSecret: string } {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) throw new CloudinaryNotConfiguredError()
  if (!configured) {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true })
    configured = true
  }
  return { cloudName, apiKey, apiSecret }
}

export function projectAssetFolder(projectSlug: string, assetType: CreativeAssetType): string {
  return `projects/${projectSlug}/${ASSET_TYPE_FOLDER[assetType]}`
}

export function projectBrandingFolder(projectSlug: string): string {
  return `projects/${projectSlug}/branding`
}

export function resourceTypeFor(assetType: CreativeAssetType): 'image' | 'video' | 'raw' {
  return ASSET_TYPE_RESOURCE[assetType]
}

export interface SignUploadOptions {
  folder: string
  publicId: string
  resourceType: 'image' | 'video' | 'raw'
  tags?: string[]
  context?: Record<string, string>
}

export interface SignedUpload {
  cloudName: string
  apiKey: string
  resourceType: 'image' | 'video' | 'raw'
  uploadUrl: string
  signature: string
  timestamp: number
  folder: string
  publicId: string
  tags: string[]
  context: Record<string, string>
}

/**
 * Mints the params + signature the frontend needs to upload a file directly
 * to Cloudinary. The VPS never sees the file bytes. Cloudinary verifies the
 * signature against the api_secret; the secret is never sent.
 */
export function signUpload(opts: SignUploadOptions): SignedUpload {
  const { cloudName, apiKey, apiSecret } = ensureConfigured()
  const timestamp = Math.floor(Date.now() / 1000)
  const tagsCsv = (opts.tags ?? []).join(',')
  const contextStr = opts.context
    ? Object.entries(opts.context)
        .map(([k, v]) => `${k}=${v}`)
        .join('|')
    : ''

  const toSign: Record<string, string | number> = {
    folder: opts.folder,
    public_id: opts.publicId,
    timestamp,
  }
  if (tagsCsv) toSign.tags = tagsCsv
  if (contextStr) toSign.context = contextStr

  const signature = cloudinary.utils.api_sign_request(toSign, apiSecret)

  return {
    cloudName,
    apiKey,
    resourceType: opts.resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${opts.resourceType}/upload`,
    signature,
    timestamp,
    folder: opts.folder,
    publicId: opts.publicId,
    tags: opts.tags ?? [],
    context: opts.context ?? {},
  }
}

export interface UploadedAsset {
  publicId: string
  secureUrl: string
  bytes: number
  format: string
}

/**
 * Server-side upload for the logo flow. We want to validate the file before
 * storing, so we proxy through the server rather than signing a direct upload.
 */
export async function uploadBuffer(
  buffer: Buffer,
  opts: {
    folder: string
    publicId?: string
    resourceType?: 'image' | 'video' | 'raw'
    tags?: string[]
    context?: Record<string, string>
  }
): Promise<UploadedAsset> {
  ensureConfigured()
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        ...(opts.publicId && { public_id: opts.publicId }),
        resource_type: opts.resourceType ?? 'image',
        ...(opts.tags && { tags: opts.tags }),
        ...(opts.context && { context: opts.context }),
      },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error('cloudinary returned no result'))
          return
        }
        resolve({
          publicId: result.public_id,
          secureUrl: result.secure_url,
          bytes: result.bytes,
          format: result.format,
        })
      }
    )
    stream.end(buffer)
  })
}

/**
 * PNG header inspector — checks color type for alpha channel without pulling
 * in sharp/jimp. PNG layout:
 *   bytes 0-7  : signature 89 50 4E 47 0D 0A 1A 0A
 *   bytes 12-15: chunk type "IHDR"
 *   byte 25    : color type — 4 (grayscale+alpha) or 6 (RGB+alpha) means alpha.
 */
export function pngHasAlpha(buffer: Buffer): { isPng: boolean; hasAlpha: boolean } {
  if (buffer.length < 26) return { isPng: false, hasAlpha: false }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== sig[i]) return { isPng: false, hasAlpha: false }
  }
  const ihdrType = buffer.toString('ascii', 12, 16)
  if (ihdrType !== 'IHDR') return { isPng: true, hasAlpha: false }
  const colorType = buffer[25]
  return { isPng: true, hasAlpha: colorType === 4 || colorType === 6 }
}
