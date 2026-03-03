import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * GET /api/docs - Serve the OpenAPI specification
 */
export async function GET() {
  try {
    const specPath = join(process.cwd(), 'src', 'app', 'api', 'docs', 'openapi.json')
    const spec = readFileSync(specPath, 'utf-8')
    return new NextResponse(spec, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    console.error('Failed to load OpenAPI spec:', error)
    return NextResponse.json({ error: 'Failed to load API specification' }, { status: 500 })
  }
}
