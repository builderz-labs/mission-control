import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getExternalWorkerById, steerExternalWorker, buildRetryPacket } from '@/lib/external-workers'
import { validateBody } from '@/lib/validation'

const bodySchema = z.object({
  action: z.enum(['steer', 'retry-packet']),
  note: z.string().optional(),
  diagnosis: z.string().optional(),
  correctedContext: z.string().optional(),
  narrowedScope: z.string().optional(),
  doNotRepeat: z.array(z.string()).optional(),
})

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await context.params
  const worker = getExternalWorkerById(Number(id))
  if (!worker) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ worker })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await context.params
  const workerId = Number(id)
  const parsed = await validateBody(request, bodySchema)
  if ('error' in parsed) return parsed.error

  try {
    if (parsed.data.action === 'steer') {
      const worker = await steerExternalWorker(workerId, parsed.data.note || '')
      return NextResponse.json({ worker })
    }
    const packet = buildRetryPacket(
      workerId,
      parsed.data.diagnosis || 'Diagnosis pending',
      parsed.data.correctedContext || '',
      parsed.data.narrowedScope || '',
      parsed.data.doNotRepeat || [],
    )
    return NextResponse.json({ packet })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Worker action failed' }, { status: 500 })
  }
}
