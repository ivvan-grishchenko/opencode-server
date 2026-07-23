# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# ---- Build stage: install all deps and compile ----
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- Production dependencies stage ----
# pnpm-workspace.yaml is required here as well: its allowBuilds list permits
# the opencode-ai postinstall that fetches the platform-specific binary.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- Runtime stage ----
# git and npm are required at runtime: the orchestrator spawns
# `git clone`, `npm install` and the `opencode` binary as child processes.
FROM node:24-alpine AS runtime
RUN apk add --no-cache git
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Make the opencode binary resolvable for spawned child processes.
ENV PATH="/app/node_modules/.bin:$PATH"

# Default workspaces location (SERVER_WORKSPACES) is <cwd>/workspaces and must be writable.
RUN mkdir -p /app/workspaces && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -qO- "http://127.0.0.1:${SERVER_PORT:-3000}/health" || exit 1

CMD ["node", "dist/main.js"]
