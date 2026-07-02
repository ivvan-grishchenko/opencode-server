# ---- builder stage ----
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY opencode.json ./

# Make the locally installed `opencode` binary available from any working directory
ENV PATH="/app/node_modules/.bin:${PATH}"

# Persist OpenCode config, data, snapshots, and cloned repos on this volume
ENV XDG_CONFIG_HOME=/data/config
ENV XDG_DATA_HOME=/data/local
ENV XDG_CACHE_HOME=/data/cache
ENV REPOS_DIR=/data/repos

EXPOSE 3000

CMD ["node", "dist/index.js"]
