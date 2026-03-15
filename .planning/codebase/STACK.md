# Technology Stack

**Analysis Date:** 2026-03-15

## Languages

**Primary:**
- TypeScript 5.7 - All application code (strict mode, `moduleResolution: bundler`)

**Secondary:**
- JavaScript - Config files (`next.config.js`, `tailwind.config.js`, `eslint.config.mjs`)

## Runtime

**Environment:**
- Node.js >= 22 (LTS; 24.x also supported)
- `.nvmrc` present with version `22`
- Native addon: `better-sqlite3` requires rebuild when switching Node versions

**Package Manager:**
- pnpm (via corepack)
- Lockfile: `pnpm-lock.yaml` present (10,968 lines)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack web framework (App Router, standalone output)
- React 19.0.1 - UI framework
- Zustand 5.0.11 - Client-side state management (with `subscribeWithSelector`)

**Testing:**
- Vitest 2.1.5 - Unit tests (jsdom environment)
- Playwright 1.51.0 - E2E tests (Chromium only, sequential)
- @testing-library/jest-dom - DOM matchers

**Build/Dev:**
- TypeScript 5.7 - Type checking (`pnpm typecheck`)
- ESLint (flat config) - Linting with `eslint-config-next`
- Tailwind CSS 3.4.17 - Utility-first styling (class-based dark mode)
- PostCSS + autoprefixer - CSS processing

## Key Dependencies

**Critical:**
- `better-sqlite3` ^12.6.2 - Embedded database (native addon)
- `zod` 4.3.6 - Runtime schema validation across API routes
- `pino` 10.3.1 - Structured logging (server-side)
- `next-intl` - i18n support

**Infrastructure:**
- `@xyflow/react` - React Flow for node-based graph visualization (already in deps)
- `react-markdown` + `remark-gfm` - Markdown rendering (transpiled in next.config.js)
- `bcrypt` / `node:crypto` - Password hashing and cryptographic operations

**LLM/AI:**
- `@anthropic-ai/sdk` - Anthropic Claude API adapter
- OpenAI-compatible adapter - Supports OpenAI, Ollama, and other providers
- Tiered LLM router - fast/standard/complex tiers with budget enforcement

**Agent Framework Adapters:**
- AutoGen, CrewAI, LangGraph, Claude SDK, OpenClaw, Generic adapters (`src/lib/adapters/`)

## Configuration

**Environment:**
- `.env` files (`.env`, `.env.example`, `.env.test`)
- Auto-generated credentials: `AUTH_SECRET`, `API_KEY` via `src/lib/auto-credentials.ts`
- Key env vars: `PORT`, `HOSTNAME`, `NODE_ENV`, `MC_DISABLE_AUTH`, `MISSION_CONTROL_DATA_DIR`, `MISSION_CONTROL_DB_PATH`
- OpenClaw integration: `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_GATEWAY_HOST/PORT`

**Build:**
- `next.config.js` - Standalone output, transpilePackages, security headers
- `tsconfig.json` - Strict mode, path alias `@/*` → `./src/*`
- `tailwind.config.js` - Custom theme with CSS variable-based colors, surface levels
- `vitest.config.ts` - jsdom, 60% coverage threshold, v8 provider
- `playwright.config.ts` - Chromium, 1 worker, 60s timeout, dot reporter

## Platform Requirements

**Development:**
- macOS/Linux (any platform with Node.js 22+)
- `corepack enable` for pnpm auto-install
- No Docker required for development

**Production:**
- Standalone mode: `node .next/standalone/server.js`
- Docker supported: `docker compose up` (zero-config)
- Hardened mode: `docker-compose.hardened.yml`
- macOS LaunchAgent for persistent local dashboard (port 8080)

---

*Stack analysis: 2026-03-15*
*Update after major dependency changes*
