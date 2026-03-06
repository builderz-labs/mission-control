import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';

const UPLOAD_DIR = join(homedir(), '.openclaw', 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/**
 * POST /api/uploads - Upload an image file
 * Accepts multipart/form-data with 'file' field
 * Returns: { url: string, filename: string }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Get file extension from original filename or MIME type
    const originalName = file.name || 'upload';
    let extension = originalName.split('.').pop()?.toLowerCase() || '';

    // Fallback to mime type if no extension
    if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
      const mimeMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
      };
      extension = mimeMap[file.type] || 'jpg';
    }

    // Generate UUID filename
    const uuid = randomUUID();
    const filename = `${uuid}.${extension}`;
    const filepath = join(UPLOAD_DIR, filename);

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Convert file to buffer and write
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filepath, buffer);

    logger.info({ filename, size: file.size, type: file.type }, 'File uploaded successfully');

    return NextResponse.json({
      url: `/api/uploads/${filename}`,
      filename,
      originalName,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/uploads error');
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}
