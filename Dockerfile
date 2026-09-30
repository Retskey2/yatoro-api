# syntax=docker/dockerfile:1

FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

# ---- production dependencies only (no drizzle-kit, biome, typescript, ...) ----
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=5084 \
    UPLOADS_DIR=/app/uploads

COPY --from=deps /app/node_modules ./node_modules
# tsconfig.json is needed at runtime: Bun resolves the "@/..." path aliases from it
COPY package.json tsconfig.json ./
COPY src ./src

RUN mkdir -p /app/uploads && chown bun:bun /app/uploads
USER bun

EXPOSE 5084

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# Migrations run before the server starts (fine for a single instance;
# with several replicas this becomes a separate release step)
CMD ["sh", "-c", "bun run src/database/migrate.ts && exec bun run src/index.ts"]
