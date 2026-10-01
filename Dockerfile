# syntax=docker/dockerfile:1
#
# Two images from one Dockerfile:
#   docker build .                  → API (the default target is the last stage)
#   docker build --target worker .  → background worker with ffmpeg

FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

# ---- production dependencies only (no drizzle-kit, biome, typescript, ...) ----
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- application code shared by the API and the worker ----
FROM base AS app
ENV NODE_ENV=production \
    PORT=5084 \
    UPLOADS_DIR=/app/uploads

COPY --from=deps /app/node_modules ./node_modules
# tsconfig.json is needed at runtime: Bun resolves the "@/..." path aliases from it
COPY package.json tsconfig.json ./
COPY src ./src

RUN mkdir -p /app/uploads && chown bun:bun /app/uploads

# ---- worker: jobs from the PostgreSQL queue, video transcoding ----
FROM app AS worker
# ffmpeg (with ffprobe) from Alpine packages; installed as root, run as `bun`
RUN apk add --no-cache ffmpeg
USER bun
CMD ["bun", "run", "src/worker/index.ts"]

# ---- API (default target) ----
FROM app AS api
USER bun

EXPOSE 5084

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# Migrations run before the server starts (fine for a single instance;
# with several replicas this becomes a separate release step)
CMD ["sh", "-c", "bun run src/database/migrate.ts && exec bun run src/index.ts"]
