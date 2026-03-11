import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { listExternalWorkers, spawnExternalWorker, babysitExternalWorkers } from '@/lib/external-workers'
import { validateBody } from '@/lib/validation'

const spawnSchema = z.object({
  taskId: z.number().int().positive().optional(),
  roleOwner: z.string().min(1),
  tool: z.enum(['codex', 'claude']),
  model: z.string().optional(),
  branch: z.string().optional(),
  taskTitle: z.string().min(1),
  prompt: z.string().min(1),
  repoPath: z.string().optional(),
  baseRef: z.string().optional(),
})

const actionSchema = z.object({
  action: z.enum(['spawn', 'babysit']),
}).and(spawnSchema.partial())

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({ workers: listExternalWorkers() })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const parsed = await validateBody(request, actionSchema)
  if ('error' in parsed) return parsed.error

  if (parsed.data.action === 'babysit') {
    const result = await babysitExternalWorkers()
    return NextResponse.json(result)
  }

  const required = spawnSchema.safeParse(parsed.data)
  if (!required.success) {
    return NextResponse.json({ error: 'Invalid spawn payload', details: required.error.issues }, { status: 400 })
  }

  try {
    const worker = await spawnExternalWorker(required.data)
    return NextResponse.json({ worker }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to spawn worker' }, { status: 500 })
  }
}
