# ═══════════════════════════════════════════════════════════════
# Base
# ═══════════════════════════════════════════════════════════════
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# ═══════════════════════════════════════════════════════════════
# Dependencies
# ═══════════════════════════════════════════════════════════════
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY scripts/install-hooks.mjs scripts/install-hooks.mjs
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/stores/package.json packages/stores/
COPY packages/app/package.json packages/app/
RUN pnpm install --frozen-lockfile

# ═══════════════════════════════════════════════════════════════
# Build
# ═══════════════════════════════════════════════════════════════
FROM deps AS build
COPY packages/ packages/
RUN pnpm --filter @agntz/contracts build
RUN pnpm --filter @agntz/core build
RUN pnpm --filter @agntz/db build
RUN pnpm --filter @agntz/stores build
RUN pnpm --filter @agntz/app build

# ═══════════════════════════════════════════════════════════════
# App runtime (Next.js)
# ═══════════════════════════════════════════════════════════════
FROM base AS app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/app/node_modules ./packages/app/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/stores/node_modules ./packages/stores/node_modules
COPY --from=build /app/packages/app/.next ./packages/app/.next
COPY --from=build /app/packages/app/package.json ./packages/app/
COPY --from=build /app/packages/app/next.config.ts ./packages/app/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/stores/dist ./packages/stores/dist
COPY --from=build /app/packages/stores/package.json ./packages/stores/
COPY pnpm-workspace.yaml package.json ./
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/packages/app
CMD ["pnpm", "start"]
