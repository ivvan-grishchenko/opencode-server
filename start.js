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
const BACKEND_READY_TIMEOUT_MS = 120_000;
const BACKEND_READY_INTERVAL_MS = 1_000;

// Ensure persistent directories exist
for (const dir of [XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, REPOS_DIR]) {
    fs.mkdirSync(dir, {recursive: true});
}

// Write OpenCode config file
const configDir = path.join(XDG_CONFIG_HOME, 'opencode');
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
    });
}

function ensureGhToken() {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to clone private or public repos via gh CLI');

    console.log('Using GITHUB_TOKEN from environment for gh CLI authentication.');
}

async function syncRepo(repo) {
    const repoPath = path.join(REPOS_DIR, repo.name);
    fs.mkdirSync(repoPath, {recursive: true});

    const branch = repo.branch || 'main';
    const fullName = `${repo.owner}/${repo.repo}`;
    const exists = fs.existsSync(path.join(repoPath, '.git'));

    if (exists) {
        console.log(`Updating existing repo: ${repo.name} (${fullName})`);
        const syncMode = process.env.REPOS_SYNC_MODE || 'pull';

        if (syncMode === 'reset') {
            await exec('git', ['-C', repoPath, 'fetch', 'origin']);
            await exec('git', ['-C', repoPath, 'reset', '--hard', `origin/${branch}`]);
        } else if (syncMode === 'pull') {
            await exec('git', ['-C', repoPath, 'pull', 'origin', branch]);
        } else if (syncMode === 'none') {
            console.log('Skipping update (REPOS_SYNC_MODE=none)');
        } else {
            throw new Error(`Unknown REPOS_SYNC_MODE: ${syncMode}`);
        }
    } else {
        console.log(`Cloning repo: ${repo.name} (${fullName})`);
        const cloneArgs = ['repo', 'clone', fullName, repoPath, '--', '--depth', '1'];
        if (repo.branch) cloneArgs.push('--branch', repo.branch);
        await exec('gh', cloneArgs);
    }
}

function startBackend(repo, index) {
    const repoPath = path.join(REPOS_DIR, repo.name);
    const port = BACKEND_BASE_PORT + index;

    repoMap.set(repo.name, {port, repoPath});
    console.log(`Starting OpenCode backend for "${repo.name}" on ${BACKEND_HOST}:${port}`);

    const { OPENCODE_SERVER_PASSWORD: _, OPENCODE_SERVER_USERNAME: __, ...backendEnv } = process.env;
    const proc = spawn('opencode', ['serve', '--hostname', BACKEND_HOST, '--port', String(port)], {
        cwd: repoPath,
        stdio: 'inherit',
        env: {
            ...backendEnv,
            XDG_CONFIG_HOME,
            XDG_DATA_HOME,
            XDG_CACHE_HOME,
            OPENCODE_DISABLE_AUTOUPDATE: 'true',
        },
    });

    repoProcesses.push(proc);
    return port;
}

async function waitForBackend(port) {
    const url = `http://${BACKEND_HOST}:${port}/global/health`;
    const start = Date.now();

    while (Date.now() - start < BACKEND_READY_TIMEOUT_MS) {
        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.get(url, res => resolve(res));
                req.on('error', reject);
                req.setTimeout(2_000, () => req.destroy(new Error('Timeout')));
            });

            if (res.statusCode === 200) {
                console.log(`Backend on port ${port} is healthy.`);
                return;
            }
        } catch {
            // Not ready yet
        }
        await new Promise(r => setTimeout(r, BACKEND_READY_INTERVAL_MS));
    }

    throw new Error(`Backend on port ${port} did not become healthy within ${BACKEND_READY_TIMEOUT_MS}ms`);
}

function startProxy() {
    const proxy = httpProxy.createProxyServer({changeOrigin: true});
    const PORT = process.env.PORT || '3000';

    const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
    const password = process.env.OPENCODE_SERVER_PASSWORD;
    if (!password) {
        throw new Error('OPENCODE_SERVER_PASSWORD is required for the proxy');
    }
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
                healthy: true,
                repos: Array.from(repoMap.keys()),
            }));
        }

        const auth = req.headers.authorization;
        if (!auth || auth !== expectedAuth) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="opencode"',
                'Content-Type': 'text/plain',
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
    ensureGhToken();

    for (const repo of repos) await syncRepo(repo);


    for (let i = 0; i < repos.length; i++) startBackend(repos[i], i);


    for (let i = 0; i < repos.length; i++) {
        const port = BACKEND_BASE_PORT + i;
        await waitForBackend(port);
    }

    startProxy();
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
