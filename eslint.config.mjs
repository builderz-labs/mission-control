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
      // React Compiler false-positive: flags intentional ref-based stable callbacks
      // where useCallback(fn, []) is correct because all accessed values are stable refs.
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
]

export default config
