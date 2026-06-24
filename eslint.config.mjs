import next from 'eslint-config-next'

const config = [
  ...next,
  {
    ignores: [
      '.data/**',
      'ops/**',
      'test-results/**',
      'playwright-report/**',
      '.tmp/**',
      '.playwright-mcp/**',
    ],
  },
  // The React 19/ESLint ecosystem is still settling. These rules are valuable,
  // but they currently trigger a lot of false positives in this codebase.
  // Keep them off until we do a dedicated refactor pass.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  // Discourage bare `fetch('/api/...')`. Code should use `apiFetch<T>()` from
  // `@/lib/api-client` so that 401 / 403 / 5xx / network failures are handled
  // uniformly (401 redirects to /login, the rest throw typed ApiError).
  // Warn level for incremental migration; api-client.ts itself is exempt.
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/lib/api-client.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.name='fetch'] > Literal[value=/^\\/api\\//]",
          message:
            "Use apiFetch<T>() from '@/lib/api-client' instead of bare fetch('/api/...'). It handles 401 redirect, 403/5xx typed errors, and network failures uniformly.",
        },
      ],
    },
  },
]

export default config
