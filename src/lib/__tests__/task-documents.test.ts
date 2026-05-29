import { describe, expect, it } from 'vitest'
import { getTaskDocumentInfo } from '../task-documents'

describe('getTaskDocumentInfo', () => {
  it('detects long markdown descriptions as full documents and exposes source file metadata', () => {
    const markdown = `# Campaign\n\n${'Long body\n'.repeat(80)}`

    const info = getTaskDocumentInfo({
      description: markdown,
      metadata: {
        source_file: '/Users/phfer/hermes-workspaces/cerberus/clients/alfaiataria-guerreiro/campanhas/2026-05-26-dia-dos-namorados.md',
        client: 'Alfaiataria Guerreiro',
        artifact_type: 'campaign_plan',
      },
    })

    expect(info.hasFullDocument).toBe(true)
    expect(info.sourceFile).toBe('/Users/phfer/hermes-workspaces/cerberus/clients/alfaiataria-guerreiro/campanhas/2026-05-26-dia-dos-namorados.md')
    expect(info.client).toBe('Alfaiataria Guerreiro')
    expect(info.artifactType).toBe('campaign_plan')
    expect(info.wordCount).toBeGreaterThan(100)
  })

  it('does not mark short operational descriptions as full documents', () => {
    const info = getTaskDocumentInfo({
      description: 'Small task description.',
      metadata: {},
    })

    expect(info.hasFullDocument).toBe(false)
    expect(info.wordCount).toBe(3)
  })
})
