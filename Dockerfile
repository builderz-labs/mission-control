FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# better-sqlite3 requires native compilation tools
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Copy public directory if it exists (may not exist in all setups)
COPY --from=build /app/public* ./public/
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
