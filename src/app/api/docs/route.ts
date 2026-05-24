import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

const cachedSpec = readFileSync(join(process.cwd(), 'openapi.json'), 'utf-8')

export async function GET() {
  return new NextResponse(cachedSpec, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
