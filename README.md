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

| File | Purpose |
|---|---|
| `Dockerfile` | Node 22 + Git + GitHub CLI image |
| `start.js` | Authenticates `gh`, clones/updates repos, starts backends and proxy |
| `opencode.json` | Default OpenCode config (OpenCode Go provider, permissions, etc.) |
| `railway.toml` | Railway config-as-code (builder, healthcheck, restart policy) |
| `package.json` | Dependencies: `opencode-ai`, `http-proxy` |
| `.env.example` | Template for environment variables |

## Prerequisites

- A [Railway](https://railway.app) account
- A GitHub repository to push this code
- A GitHub personal access token with **`repo`** scope
- An [OpenCode Go](https://opencode.ai/auth) API key

## Environment Variables

Set these in the Railway service dashboard. Secrets (`GITHUB_TOKEN`, `OPENCODE_GO_API_KEY`, `OPENCODE_SERVER_PASSWORD`) should be encrypted.

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | GitHub PAT used by `gh` to clone private/public repos |
| `OPENCODE_GO_API_KEY` | Yes | OpenCode Go provider API key |
| `OPENCODE_SERVER_PASSWORD` | Yes | Password for HTTP Basic Auth |
| `OPENCODE_SERVER_USERNAME` | No | Username for HTTP Basic Auth (default: `opencode`) |
| `REPOS_JSON` | Yes | JSON array of repos to clone (see below) |
| `REPOS_SYNC_MODE` | No | `pull` (default), `reset`, or `none` |
| `XDG_CONFIG_HOME` | Yes | `/data/config` |
| `XDG_DATA_HOME` | Yes | `/data/local` |
| `XDG_CACHE_HOME` | Yes | `/data/cache` |
| `REPOS_DIR` | Yes | `/data/repos` (set in Dockerfile) |

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

### `REPOS_SYNC_MODE`

| Mode | Behavior on redeploy |
|---|---|
| `pull` | `git pull origin <branch>` |
| `reset` | `git fetch origin && git reset --hard origin/<branch>` |
| `none` | Skip updates |

Use `reset` if you want the server to discard local changes made by the agent and start fresh from the remote branch.

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
   curl -u opencode:YOUR_PASSWORD https://your-domain.up.railway.app/health
   curl -u opencode:YOUR_PASSWORD https://your-domain.up.railway.app/repo-a/project/current
   ```

## Cloudflare Worker Client

The Worker talks to the proxy with Basic Auth. Each repo is addressed by path prefix.

```typescript
export class OpencodeClient {
  constructor(
    private baseUrl: string,
    private username: string,
    private password: string
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

  health() { return this.call('/global/health'); }
  currentProject() { return this.call('/project/current'); }
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
  env.OPENCODE_SERVER_PASSWORD
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

### Docker build

```bash
docker build -t opencode-server .
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` | Wrong `OPENCODE_SERVER_PASSWORD` or missing `Authorization` header |
| `404 Repo "x" not found` | `name` in `REPOS_JSON` does not match the URL path |
| `502 Backend unavailable` | OpenCode backend is still starting; retry after a few seconds |
| `gh auth login` fails | `GITHUB_TOKEN` is missing or lacks `repo` scope |
| Deploy fails healthcheck | `/health` must return 200. Check deploy logs for startup errors. |
| Health check passes but repo endpoints fail | Backends may have failed to start. Check logs for `opencode serve` errors. |

## Updating

- **OpenCode version**: bump `opencode-ai` in `package.json`, run `npm install`, commit `package-lock.json`, push
- **Add a repo**: update `REPOS_JSON`, push, redeploy
- **Update provider/model**: edit `opencode.json` or override with `OPENCODE_CONFIG_CONTENT`
