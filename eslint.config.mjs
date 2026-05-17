import next from 'eslint-config-next'

const config = [
  ...next,
  {
    ignores: [
      '.data/**',
      'ops/**',
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
  // P1.5 — Discourage bare `fetch('/api/...')`.
  // The team must migrate to `apiFetch<T>()` from `@/lib/api-client` so that
  // 401 / 403 / 5xx / network failures are handled uniformly.
  // Phase 1 (this PR): warn level, allow incremental migration.
  // Phase 3 (final cleanup): upgrade to error and forbid merges that introduce
  // new bare fetch('/api/...') sites.
  // Selector rationale:
  //   - covers single-quoted, double-quoted, and template-literal forms
  //   - filters by /api prefix so cross-origin / external fetches stay untouched
  //   - exempts api-client.ts itself (the one allowed implementer)
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
            "Use apiFetch<T>() from '@/lib/api-client' instead of bare fetch('/api/...'). It handles 401 redirect, 403/5xx typed errors, and network failures uniformly. See PR-api-client.md.",
        },
        {
          selector:
            "CallExpression[callee.name='fetch'] > TemplateLiteral.arguments:first-child[quasis.0.value.raw=/^\\/api\\//]",
          message:
            "Use apiFetch<T>() from '@/lib/api-client' instead of bare fetch(`/api/...`). It handles 401 redirect, 403/5xx typed errors, and network failures uniformly.",
        },
      ],
    },
  },
]

export default config
