/**
 * Framework Templates Test Suite
 *
 * Tests the framework-agnostic template registry, ensuring:
 *   - All adapters have corresponding framework info
 *   - Universal templates map correctly to framework-specific configs
 *   - Template resolution works for all framework/template combinations
 */

import { describe, it, expect } from 'vitest'
import {
  FRAMEWORK_REGISTRY,
  UNIVERSAL_TEMPLATES,
  listFrameworks,
  getFrameworkInfo,
  getTemplatesForFramework,
  getUniversalTemplate,
  resolveTemplateConfig,
} from '../framework-templates'
import { listAdapters } from '../adapters'
import { AGENT_TEMPLATES } from '../agent-templates'

describe('Framework Registry', () => {
  it('has an entry for every registered adapter', () => {
    const adapters = listAdapters()
    for (const adapter of adapters) {
      expect(FRAMEWORK_REGISTRY[adapter]).toBeDefined()
      expect(FRAMEWORK_REGISTRY[adapter].id).toBe(adapter)
    }
  })

  it('every framework has required connection config', () => {
    for (const fw of listFrameworks()) {
      expect(fw.connection).toBeDefined()
      expect(fw.connection.connectionMode).toMatch(/^(webhook|polling|websocket)$/)
      expect(fw.connection.heartbeatInterval).toBeGreaterThan(0)
      expect(fw.connection.setupHints.length).toBeGreaterThan(0)
      expect(fw.connection.exampleSnippet.length).toBeGreaterThan(0)
    }
  })

  it('every framework has a label and description', () => {
    for (const fw of listFrameworks()) {
      expect(fw.label).toBeTruthy()
      expect(fw.description).toBeTruthy()
    }
  })

  it('getFrameworkInfo returns correct framework', () => {
    const info = getFrameworkInfo('langgraph')
    expect(info?.id).toBe('langgraph')
    expect(info?.label).toBe('LangGraph')
  })

  it('getFrameworkInfo returns undefined for unknown', () => {
    expect(getFrameworkInfo('nonexistent')).toBeUndefined()
  })
})

describe('Universal Templates', () => {
  it('has at least 5 template archetypes', () => {
    expect(UNIVERSAL_TEMPLATES.length).toBeGreaterThanOrEqual(5)
  })

  it('every template has required fields', () => {
    for (const tpl of UNIVERSAL_TEMPLATES) {
      expect(tpl.type).toBeTruthy()
      expect(tpl.label).toBeTruthy()
      expect(tpl.description).toBeTruthy()
      expect(tpl.emoji).toBeTruthy()
      expect(tpl.frameworks.length).toBeGreaterThan(0)
      expect(tpl.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('every template supports at least "generic" framework', () => {
    for (const tpl of UNIVERSAL_TEMPLATES) {
      expect(tpl.frameworks).toContain('generic')
    }
  })

  it('templates with openclawTemplateType reference valid OpenClaw templates', () => {
    for (const tpl of UNIVERSAL_TEMPLATES) {
      if (tpl.openclawTemplateType) {
        const ocTemplate = AGENT_TEMPLATES.find(t => t.type === tpl.openclawTemplateType)
        expect(ocTemplate).toBeDefined()
      }
    }
  })

  it('getUniversalTemplate returns correct template', () => {
    const tpl = getUniversalTemplate('developer')
    expect(tpl?.type).toBe('developer')
    expect(tpl?.label).toBe('Developer')
  })

  it('getUniversalTemplate returns undefined for unknown', () => {
    expect(getUniversalTemplate('nonexistent')).toBeUndefined()
  })
})

describe('Template-Framework Resolution', () => {
  it('offers an observation-only template for nanobot', () => {
    expect(getTemplatesForFramework('nanobot').map(template => template.type)).toEqual(['observer'])
    expect(getFrameworkInfo('nanobot')?.connection.setupHints.join(' ')).toContain('Observation only')
  })
  it('getTemplatesForFramework returns templates for known frameworks', () => {
    for (const fw of listAdapters()) {
      const templates = getTemplatesForFramework(fw)
      expect(templates.length).toBeGreaterThan(0)
    }
  })

  it('getTemplatesForFramework returns empty for unknown framework', () => {
    expect(getTemplatesForFramework('nonexistent')).toEqual([])
  })

  it('resolveTemplateConfig returns OpenClaw template for openclaw framework', () => {
    const result = resolveTemplateConfig('developer', 'openclaw')
    expect(result).toBeDefined()
    expect(result?.template).toBeDefined()
    expect(result?.template?.type).toBe('developer')
    expect(result?.universal.type).toBe('developer')
  })

  it('resolveTemplateConfig returns universal-only for non-openclaw frameworks', () => {
    const result = resolveTemplateConfig('developer', 'langgraph')
    expect(result).toBeDefined()
    expect(result?.template).toBeUndefined()
    expect(result?.universal.type).toBe('developer')
  })

  it('resolveTemplateConfig returns undefined for unknown template', () => {
    expect(resolveTemplateConfig('nonexistent', 'generic')).toBeUndefined()
  })

  it('resolveTemplateConfig returns undefined for unsupported framework', () => {
    expect(resolveTemplateConfig('developer', 'nonexistent')).toBeUndefined()
  })

  it('all universal templates resolve for all their declared frameworks', () => {
    for (const tpl of UNIVERSAL_TEMPLATES) {
      for (const fw of tpl.frameworks) {
        const result = resolveTemplateConfig(tpl.type, fw)
        expect(result).toBeDefined()
        expect(result?.universal.type).toBe(tpl.type)
      }
    }
  })
})
