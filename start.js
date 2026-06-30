/**
 * OpenCode Railway deployment orchestrator.
 *
 * Responsibilities:
 * 1. Authenticate the GitHub CLI using GITHUB_TOKEN.
 * 2. Clone or update each configured repo into /data/repos/<name>.
 * 3. Start one `opencode serve` backend per repo (localhost only).
 * 4. Wait for all backends to report healthy.
 * 5. Start a public HTTP proxy on $PORT that routes /<repo-name>/* to the
 *    matching backend and enforces HTTP Basic Auth.
 */

const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const httpProxy = require('http-proxy');

const REPOS_DIR = process.env.REPOS_DIR || '/data/repos';
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || '/data/config';
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || '/data/local';
const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || '/data/cache';

const BACKEND_HOST = '127.0.0.1';
const BACKEND_BASE_PORT = 5000;
const BACKEND_READY_TIMEOUT_MS = 60_000;
const BACKEND_READY_INITIAL_DELAY_MS = 200;
const BACKEND_READY_MAX_DELAY_MS = 1_000;
const BACKEND_PROBE_TIMEOUT_MS = 2_000;
// Probe path on the opencode HTTP server. `/app` is the liveness endpoint
// available in opencode-ai 0.1.x. `/global/health` was added in a later
// release; keep this in sync when bumping `opencode-ai`.
const BACKEND_PROBE_PATH = '/app';

// Ensure persistent directories exist
for (const dir of [XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, REPOS_DIR]) {
    fs.mkdirSync(dir, {recursive: true});
}

// Write OpenCode config file
const configDir = path.join(XDG_CONFIG_HOME, '.opencode');
fs.mkdirSync(configDir, {recursive: true});
const configPath = path.join(configDir, 'opencode.json');

if (process.env.OPENCODE_CONFIG_CONTENT) {
    fs.writeFileSync(configPath, process.env.OPENCODE_CONFIG_CONTENT);
    console.log('Wrote OpenCode config from OPENCODE_CONFIG_CONTENT');
} else if (!fs.existsSync(configPath) && fs.existsSync('/app/opencode.json')) {
    fs.copyFileSync('/app/opencode.json', configPath);
    console.log('Copied default OpenCode config');
}

const repos = JSON.parse(process.env.REPOS_JSON || '[]');
if (!Array.isArray(repos) || repos.length === 0) {
    console.error('ERROR: REPOS_JSON must be a non-empty JSON array of repos.');
    console.error('Example: [{ "name": "repo-a", "owner": "myorg", "repo": "repo-a", "branch": "main" }]');
    process.exit(1);
}

const repoMap = new Map();
const repoProcesses = [];

function exec(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        console.log(`> ${cmd} ${args.join(' ')}`);
        const child = spawn(cmd, args, {stdio: 'inherit', env: process.env, ...opts});
        child.on('exit', code => {
            if (code === 0) return resolve();
            reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
        });
        child.on('error', err => {
            console.error(err);
            reject(err);
        })
    });
}

function ensureGhToken() {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to clone private or public repos via gh CLI');

    console.log('Configuring git to use GITHUB_TOKEN for github.com...');
}

async function syncRepo(repo) {
    const repoPath = path.join(REPOS_DIR, repo.name);
    fs.mkdirSync(REPOS_DIR, {recursive: true});

    const branch = repo.branch || 'main';
    const fullName = `${repo.owner}/${repo.repo}`;
    const exists = fs.existsSync(path.join(repoPath, '.git'));

    if (exists) {
        console.log(`Updating existing repo: ${repo.name} (${fullName})`);
        await exec('gh', ['repo', 'sync', '--branch', branch], {cwd: repoPath});
        return;
    }

    console.log(`Cloning repo: ${repo.name} (${fullName}) into ${repoPath}`);
    const cloneArgs = ['repo', 'clone', fullName, repoPath, '--', '--depth=1'];
    if (repo.branch) cloneArgs.push('--branch', repo.branch);
    await exec('gh', cloneArgs, {cwd: REPOS_DIR});
}

function startBackend(repo, index) {
    const repoPath = path.join(REPOS_DIR, repo.name);
    const port = BACKEND_BASE_PORT + index;

    repoMap.set(repo.name, {port, repoPath});
    console.log(`Starting OpenCode backend for "${repo.name}" on ${BACKEND_HOST}:${port}`);

    const {OPENCODE_SERVER_PASSWORD: _, OPENCODE_SERVER_USERNAME: __, ...backendEnv} = process.env;
    const proc = spawn('opencode', ['serve', '--hostname', BACKEND_HOST, '--port', String(port)], {
        cwd: repoPath, stdio: 'inherit', env: {
            ...backendEnv, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, OPENCODE_DISABLE_AUTOUPDATE: 'true',
        },
    });

    repoProcesses.push(proc);
    return port;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function jitteredDelay(base) {
    const delta = base * 0.2;
    return base - delta + Math.random() * 2 * delta;
}

const TRANSIENT_NETWORK_ERRORS = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'EPIPE', 'ETIMEDOUT',
]);

async function waitForBackend(port) {
    const url = `http://${BACKEND_HOST}:${port}${BACKEND_PROBE_PATH}`;
    const start = Date.now();
    let delay = BACKEND_READY_INITIAL_DELAY_MS;

    while (Date.now() - start < BACKEND_READY_TIMEOUT_MS) {
        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.get(url, resolve);
                req.on('error', reject);
                req.setTimeout(BACKEND_PROBE_TIMEOUT_MS, () => req.destroy(new Error('probe-timeout')));
            });

            if (res.statusCode === 200) {
                console.log(`Backend on port ${port} is healthy.`);
                res.resume();
                return;
            }

            // 404 on a static probe path means the path doesn't exist on
            // this opencode version — a code bug, not a startup race.
            // Fail fast so the bug surfaces immediately rather than after
            // the time budget.
            if (res.statusCode === 404) {
                res.resume();
                throw new Error(
                    `Backend on port ${port} returned HTTP 404 for ${BACKEND_PROBE_PATH}. ` +
                    `The probe path may not exist in this opencode version.`
                );
            }

            console.log(`Backend on port ${port} returned HTTP ${res.statusCode}, retrying...`);
            res.resume();
        } catch (err) {
            // Only swallow transient connection errors / probe timeouts —
            // those mean "not ready yet". Anything else (incl. the 404 we
            // throw above) is fatal.
            const isTransient = err && (
                err.message === 'probe-timeout' || TRANSIENT_NETWORK_ERRORS.has(err.code)
            );
            if (!isTransient) throw err;
        }

        await sleep(jitteredDelay(delay));
        delay = Math.min(delay * 2, BACKEND_READY_MAX_DELAY_MS);
    }

    throw new Error(`Backend on port ${port} did not become healthy within ${BACKEND_READY_TIMEOUT_MS}ms`);
}

function startProxy() {
    const proxy = httpProxy.createProxyServer({changeOrigin: true});
    const PORT = process.env.PORT || '3000';

    const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
    const password = process.env.OPENCODE_SERVER_PASSWORD;
    if (!password) throw new Error('OPENCODE_SERVER_PASSWORD is required for the proxy');

    const expectedAuth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

    const server = http.createServer((req, res) => {
        const match = req.url.match(/^\/([^/]+)(\/.*)?$/);
        if (!match) {
            res.writeHead(404, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({error: 'Not found'}));
        }

        const repoName = match[1];
        const targetPath = match[2] || '/';

        if (repoName === 'health') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({
                healthy: true, repos: Array.from(repoMap.keys()),
            }));
        }

        const auth = req.headers.authorization;
        if (!auth || auth !== expectedAuth) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="opencode"', 'Content-Type': 'text/plain',
            });
            return res.end('Unauthorized');
        }

        const backend = repoMap.get(repoName);
        if (!backend) {
            res.writeHead(404, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({error: `Repo "${repoName}" not found`}));
        }

        req.url = targetPath;
        proxy.web(req, res, {target: `http://${BACKEND_HOST}:${backend.port}`}, err => {
            console.error(`Proxy error for /${repoName}: ${err.message}`);
            if (!res.headersSent) {
                res.writeHead(502, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Backend unavailable', message: err.message}));
            }
        });
    });

    proxy.on('error', err => {
        console.error('Proxy internal error:', err.message);
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Proxy listening on 0.0.0.0:${PORT}`);
        console.log('Available repos:');
        for (const [name, {port}] of repoMap) {
            console.log(`  /${name} -> ${BACKEND_HOST}:${port}`);
        }
    });
}

function shutdown(signal) {
    console.log(`\nReceived ${signal}. Shutting down backends...`);
    for (const proc of repoProcesses) {
        proc.kill(signal);
    }
    setTimeout(() => process.exit(0), 5_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
    try {
        ensureGhToken();

        console.log('Synchronizing configured repositories...');
        await Promise.all(repos.map((repo) => syncRepo(repo)));

        console.log('Bootstrapping backend services...');
        // Start backends sequentially to avoid SQLite database-lock races when
        // multiple opencode processes share the same XDG_DATA_HOME directory.
        for (let i = 0; i < repos.length; i++) {
            const port = startBackend(repos[i], i);
            await waitForBackend(port);
        }
        console.log('All individual backends healthy.');

        startProxy();
    } catch (error) {
        console.error('Critical orchestrator failure during bootstrap:', error.message);
        shutdown('SIGTERM');
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
