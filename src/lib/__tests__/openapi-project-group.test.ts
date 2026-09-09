import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('OpenAPI project group contract', () => {
  const openapi = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'openapi.json'), 'utf8'))
  const groupSchema = { type: ['string', 'null'], maxLength: 64 }

  it('exposes group_name only on project create, update, and response contracts', () => {
    const createProperties = openapi.paths['/api/projects'].post.requestBody.content['application/json'].schema.properties
    const updateProperties = openapi.paths['/api/projects/{id}'].patch.requestBody.content['application/json'].schema.properties
    const projectProperties = openapi.components.schemas.Project.properties

    expect(createProperties.group_name).toEqual(groupSchema)
    expect(updateProperties.group_name).toEqual(groupSchema)
    expect(projectProperties.group_name).toEqual(groupSchema)
    expect(openapi.paths['/api/alerts']?.put?.requestBody?.content?.['application/json']?.schema?.properties?.group_name).toBeUndefined()
    expect(openapi.paths['/api/pipelines']?.post?.requestBody?.content?.['application/json']?.schema?.properties?.group_name).toBeUndefined()
    expect(openapi.components.schemas.AlertRule.properties.group_name).toBeUndefined()

    const occurrences: string[] = []
    for (const [pathName, pathItem] of Object.entries(openapi.paths)) {
      for (const [method, operation] of Object.entries(pathItem as Record<string, unknown>)) {
        const requestBody = operation && typeof operation === 'object'
          ? (operation as { requestBody?: { content?: { ['application/json']?: { schema?: { properties?: Record<string, unknown> } } } } }).requestBody
          : undefined
        if (requestBody?.content?.['application/json']?.schema?.properties?.group_name) {
          occurrences.push(`${method.toUpperCase()} ${pathName}`)
        }
      }
    }
    for (const [schemaName, schema] of Object.entries(openapi.components.schemas as Record<string, { properties?: Record<string, unknown> }>)) {
      if (schema?.properties?.group_name) occurrences.push(`schema ${schemaName}`)
    }

    expect(occurrences.sort()).toEqual([
      'PATCH /api/projects/{id}',
      'POST /api/projects',
      'schema Project',
    ])
  })
})
