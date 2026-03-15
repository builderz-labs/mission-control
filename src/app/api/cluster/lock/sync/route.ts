import { NextResponse } from 'next/server'
import { fileLockRegistry } from '@/lib/file-lock-registry'
import { logger } from '@/lib/logger'

export async function POST(req: Request) {
  try {
    const { type, file_path, session_id } = await req.json()
    
    // Security: In a real cluster, verify X-Aegis-Cluster-Key
    
    if (type === 'FILE_CLAIM') {
      logger.info({ file_path, session_id }, 'Cluster lock sync: Claiming file')
      fileLockRegistry.claim(file_path, session_id)
    } else if (type === 'FILE_RELEASE') {
      logger.info({ file_path, session_id }, 'Cluster lock sync: Releasing file')
      fileLockRegistry.release(file_path, session_id)
    }
    
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
