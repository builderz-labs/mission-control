# Contributing to Mission Control

Thank you for your interest in contributing to Mission Control.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/builderz-labs/mission-control.git
cd mission-control

# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env
# Edit .env with your values

# Start development server
pnpm dev
```

## Development Workflow

1. Fork the repository and create a feature branch from `main`.
2. Make your changes. Keep commits focused and descriptive.
3. Run the quality gate before submitting:
   ```bash
   pnpm quality:gate  # lint + typecheck + test + e2e + build
   ```
4. Open a pull request against `main` using the PR template.

Do not push feature work directly to `main`. Maintainers merge reviewed pull requests after hosted checks pass. Keep generated files, dependency updates, refactors, and behavior changes in separate pull requests unless they must ship together.

## Code Style

- TypeScript strict mode; no `any` unless absolutely necessary.
- Tailwind CSS for styling; use semantic design tokens (`text-foreground`, `bg-card`, etc.).
- Server components by default; `'use client'` only when needed.
- API routes use `requireRole()` for auth and return JSON responses.

## Project Structure

- `src/app/api/`: Next.js API routes (REST endpoints)
- `src/components/panels/`: Feature panels rendered by the SPA shell
- `src/components/layout/`: Navigation, header, and layout components
- `src/lib/`: Shared utilities (auth, database, config, scheduler)
- `src/store/`: Zustand state management

## Testing

- **Unit tests**: Vitest (`pnpm test`)
- **E2E tests**: Playwright (`pnpm test:e2e`)
- **Type checking**: `pnpm typecheck`
- **Lint**: `pnpm lint`

## Reporting Bugs

Use the bug report form for reproducible product failures. Remove credentials, tokens, private prompts, personal data, hostnames, and internal paths from logs and screenshots.

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
