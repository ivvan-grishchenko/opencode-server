# OpenCode Server on Railway

Deploy [OpenCode](https://opencode.ai) as a headless HTTP server on [Railway](https://railway.app), with support for **multiple GitHub repositories** and a **Cloudflare Worker** client.

## Architecture

```
Cloudflare Worker
        |
        | HTTPS + Basic Auth
        v
   Railway Service
        |
        |---- Proxy (public, port $PORT)
        |       routes /<repo-name>/*
        |
        |---- OpenCode backend #1 (repo-a, localhost:5000)
        |---- OpenCode backend #2 (repo-b, localhost:5001)
        |---- ...
```

Each configured repository gets its own `opencode serve` process. This lets the client create sessions **inside a specific project/repository** through a single public URL:

```
https://your-domain.up.railway.app/repo-a/session
https://your-domain.up.railway.app/repo-b/session
```

## Files

| File                               | Purpose                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `Dockerfile`                       | Multi-stage Node 22 image (builds TS, drops `gh` CLI — uses `simple-git` + token auth) |
| `src/index.ts`                     | Entry point; creates the pino logger and calls the orchestrator                        |
| `src/orchestrator.ts`              | Lifecycle: bootstrap → sync → spawn → probe → serve → shutdown                         |
| `src/config/`                      | Typed env parsing (zod) + directory/config bootstrap                                   |
| `src/repos/`                       | Repo clone/sync via `simple-git` (auth via `http.extraheader`, not persisted)          |
| `src/processes/`                   | `opencode serve` spawning with supervised restart (10-attempt ceiling)                 |
| `src/health/`                      | HTTP probe + jittered exponential-backoff health checker                               |
| `src/server/`                      | Fastify app, `@fastify/http-proxy` per repo, `@fastify/basic-auth`, Scalar docs        |
| `opencode.json`                    | Default OpenCode config (OpenCode Go provider, permissions, etc.)                      |
| `railway.toml`                     | Railway config-as-code (builder, healthcheck, restart policy)                          |
| `package.json`                     | Runtime deps + lint/format scripts                                                     |
| `.oxlintrc.json` / `.oxfmtrc.json` | Oxlint linting + Oxfmt formatting config                                               |
| `.gitattributes`                   | LF line-ending normalization; `dist/` & lockfile marked generated                      |
| `.env.example`                     | Template for environment variables                                                     |

## Prerequisites

- A [Railway](https://railway.app) account
- A GitHub repository to push this code
- A GitHub personal access token with **`repo`** scope
- An [OpenCode Go](https://opencode.ai/auth) API key

## Environment Variables

Set these in the Railway service dashboard. Secrets (`GITHUB_TOKEN`, `OPENCODE_GO_API_KEY`, `OPENCODE_SERVER_PASSWORD`) should be encrypted.

| Variable                   | Required | Description                                                   |
| -------------------------- | -------- | ------------------------------------------------------------- |
| `GITHUB_TOKEN`             | Yes      | GitHub PAT used by `simple-git` to clone private/public repos |
| `OPENCODE_GO_API_KEY`      | Yes      | OpenCode Go provider API key                                  |
| `OPENCODE_SERVER_PASSWORD` | Yes      | Password for HTTP Basic Auth                                  |
| `OPENCODE_SERVER_USERNAME` | No       | Username for HTTP Basic Auth (default: `opencode`)            |
| `REPOS_JSON`               | Yes      | JSON array of repos to clone (see below)                      |
| `XDG_CONFIG_HOME`          | Yes      | `/data/config`                                                |
| `XDG_DATA_HOME`            | Yes      | `/data/local`                                                 |
| `XDG_CACHE_HOME`           | Yes      | `/data/cache`                                                 |
| `REPOS_DIR`                | Yes      | `/data/repos` (set in Dockerfile)                             |

### `REPOS_JSON` format

```json
[
  { "name": "repo-a", "owner": "myorg", "repo": "repo-a", "branch": "main" },
  { "name": "repo-b", "owner": "myorg", "repo": "repo-b", "branch": "develop" }
]
```

- `name`: the URL path segment for this repo (`/<name>/...`)
- `owner` / `repo`: GitHub `owner/repo` identifier
- `branch`: branch to clone (default: `main`)

## Railway Deployment

1. **Create a Railway project**
   - Dashboard: **New Project** → **Empty Project**
   - Name it `opencode-server`

2. **Add the GitHub repo as a service**
   - **New** → **GitHub Repo** → select your repo
   - Railway detects `railway.toml` and uses the Dockerfile

3. **Add a persistent volume**
   - Service → **Volumes** → **Add New Volume**
   - Mount path: `/data`
   - Start with 20 GB

4. **Set environment variables**
   - Service → **Variables**
   - Add all variables from `.env.example`
   - Encrypt the three secrets

5. **Generate a public domain**
   - Service → **Settings** → **Networking** → **Generate Domain**

6. **Verify**

   ```bash
   # Health probe is unauthenticated (Railway/Docker healthcheck)
   curl -s https://your-domain.up.railway.app/health

   # Proxy routes and docs require Basic Auth
   curl -u opencode:YOUR_PASSWORD https://your-domain.up.railway.app/repo-a/project/current
   curl -u opencode:YOUR_PASSWORD https://your-domain.up.railway.app/reference
   ```

## Authentication

HTTP Basic Auth is enforced on every route **except** `/health`:

| Route                     | Auth       | Notes                                                                |
| ------------------------- | ---------- | -------------------------------------------------------------------- |
| `/health`                 | None       | Required by Railway/Docker healthchecks                              |
| `/<repo>/*`               | Basic Auth | Credentials: `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` |
| `/reference`              | Basic Auth | Scalar API reference UI                                              |
| `/reference/openapi.json` | Basic Auth | Raw OpenAPI 3.1 spec                                                 |

The `Authorization` header must be `Basic <base64(username:password)>`. The Cloudflare Worker example below shows the correct format.

## API documentation

An interactive Scalar API reference is served at `/reference` (behind Basic Auth):

```
https://your-domain.up.railway.app/reference
```

The underlying OpenAPI 3.1 spec is available at `/reference/openapi.json` and `/reference/openapi.yaml` (also behind Basic Auth). The document is hand-authored (static) and describes the unauthenticated `/health` probe and the authenticated `/{repo}/*` proxy convention; the dynamic per-repo pass-through routes are intentionally not enumerated (they forward to each `opencode serve` backend's own HTTP API).

## Cloudflare Worker Client

The Worker talks to the proxy with Basic Auth. Each repo is addressed by path prefix.

```typescript
export class OpencodeClient {
  constructor(
    private baseUrl: string,
    private username: string,
    private password: string,
  ) {}

  private auth() {
    return 'Basic ' + btoa(`${this.username}:${this.password}`);
  }

  private async call(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: this.auth(),
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  }

  health() {
    return this.call('/global/health');
  }
  currentProject() {
    return this.call('/project/current');
  }
  createSession(title: string) {
    return this.call('/session', { method: 'POST', body: JSON.stringify({ title }) });
  }
  sendPrompt(sessionId: string, text: string) {
    return this.call(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    });
  }
}

// Usage
const client = new OpencodeClient(
  'https://your-domain.up.railway.app/repo-a',
  'opencode',
  env.OPENCODE_SERVER_PASSWORD,
);

const session = await client.createSession('Review auth flow');
const result = await client.sendPrompt(session.id, 'Explain src/auth.ts');
```

## Local Development Notes

### Windows `npm install`

`opencode-ai`'s postinstall script has a platform-package naming mismatch on Windows. If local `npm install` fails, use:

```bash
npm install --ignore-scripts
```

This is only a local issue. The Linux Docker image installs `opencode-ai` correctly.

### Local linting & formatting

```bash
npm run lint           # oxlint (fast Rust linter)
npm run lint:fix       # oxlint with --fix
npm run format         # oxfmt (Prettier-compatible, writes)
npm run format:check   # oxfmt --check (CI)
npm run typecheck      # tsc --noEmit
```

### Docker build

```bash
docker build -t opencode-server .
```

## Troubleshooting

| Symptom                                     | Likely cause                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `401 Unauthorized` on `/<repo>/*`           | Missing/malformed `Authorization: Basic ...` header (only `/health` is public) |
| `401 Unauthorized` on `/reference`          | Docs endpoint also requires Basic Auth                                         |
| `404 Repo "x" not found`                    | `name` in `REPOS_JSON` does not match the URL path                             |
| `502 Backend unavailable`                   | OpenCode backend is still starting; retry after a few seconds                  |
| Repo clone/update fails                     | `GITHUB_TOKEN` is missing or lacks `repo` scope                                |
| Deploy fails healthcheck                    | `/health` must return 200. Check deploy logs for startup errors.               |
| Health check passes but repo endpoints fail | Backends may have failed to start. Check logs for `opencode serve` errors.     |

## Updating

- **OpenCode version**: bump `opencode-ai` in `package.json`, run `npm install`, commit `package-lock.json`, push
- **Add a repo**: update `REPOS_JSON`, push, redeploy
- **Update provider/model**: edit `opencode.json` or override with `OPENCODE_CONFIG_CONTENT`

## Architecture (rewritten)

The server is now TypeScript + [Fastify](https://fastify.dev), split into single-responsibility modules:

```
src/
├─ index.ts                  # pino logger + orchestrator.run()
├─ orchestrator.ts           # bootstrap → sync → spawn → probe → serve → shutdown
├─ config/
│  ├─ env.ts                 # zod-validated env (REPOS_JSON parsed per-element)
│  └─ bootstrap.ts           # mkdir -p XDG dirs, materialize opencode.json
├─ repos/
│  └─ repo-manager.ts        # simple-git clone/fetch+hard-reset (token via extraheader)
├─ processes/
│  ├─ child-supervisor.ts    # spawn `opencode serve`, supervised restart (≤10 tries)
│  └─ process-manager.ts     # owns supervisors, sequential start, name→backend map
├─ health/
│  ├─ probe.ts               # single GET probe (404 fatal, transient swallowed)
│  └─ health-checker.ts      # jittered exponential backoff (200ms→1s, 60s budget)
└─ server/
   ├─ app.ts                 # Fastify factory
   ├─ openapi-document.ts    # static OpenAPI 3.1 spec (health + proxy convention)
   ├─ schemas/
   │  └─ health-schema.ts    # shared JSON schema for /health (route + OpenAPI)
   ├─ plugins/
   │  ├─ basic-auth.plugin.ts  # @fastify/basic-auth (skips /health)
   │  ├─ proxy.plugin.ts       # @fastify/http-proxy per repo (prefix stripped)
   │  └─ scalar.plugin.ts      # @scalar/fastify-api-reference at /reference
   └─ routes/
      └─ health.route.ts       # GET /health → { healthy, repos[] }
```

Backends start sequentially (avoids SQLite lock races on shared `XDG_DATA_HOME`). A crashed backend is restarted with exponential backoff (1s→60s cap); after 10 consecutive failures the supervisor gives up and the proxy returns `502` for that repo while keeping the others alive.
