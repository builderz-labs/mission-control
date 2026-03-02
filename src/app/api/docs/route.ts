import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

let cachedSpec: string | null = null

export async function GET() {
  if (!cachedSpec) {
    const specPath = join(process.cwd(), 'openapi.json')
    cachedSpec = readFileSync(specPath, 'utf-8')
  }

  return new NextResponse(cachedSpec, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
