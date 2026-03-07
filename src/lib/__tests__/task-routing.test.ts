import { describe, it, expect } from 'vitest'
import { resolveTaskImplementationTarget } from '@/lib/task-routing'

describe('resolveTaskImplementationTarget', () => {
  it('returns explicit implementation target metadata when present', () => {
    const result = resolveTaskImplementationTarget({
      metadata: {
        implementation_repo: 'torreypjones/cloudstack-razor',
        code_location: '/apps/api',
      },
    })

    expect(result).toEqual({
      implementation_repo: 'torreypjones/cloudstack-razor',
      code_location: '/apps/api',
    })
  })

  it('supports legacy metadata keys for backward compatibility', () => {
    const result = resolveTaskImplementationTarget({
      metadata: {
        github_repo: 'torreypjones/cloudstack-razor',
        path: '/packages/core',
      },
    })

    expect(result).toEqual({
      implementation_repo: 'torreypjones/cloudstack-razor',
      code_location: '/packages/core',
    })
  })

  it('returns empty object for missing metadata', () => {
    expect(resolveTaskImplementationTarget({ metadata: null })).toEqual({})
  })
})
