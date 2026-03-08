import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getCrmContact, getCrmContactTags } from '@/lib/crm'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { id } = await params
  const contactId = Number(id)
  if (!Number.isFinite(contactId) || contactId < 1) {
    return NextResponse.json({ error: 'Invalid contact ID' }, { status: 400 })
  }

  const contact = getCrmContact(contactId)
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  const tags = getCrmContactTags(contactId)
  return NextResponse.json({ contact, tags })
}
