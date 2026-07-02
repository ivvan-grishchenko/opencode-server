import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import type { Logger } from 'pino';

import type { Env, RepoConfig } from '../config/env.js';
import { waitForBackend } from '../health/health-checker.js';

const BACKEND_HOST = '127.0.0.1';
const RESTART_INITIAL_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 60_000;
const MAX_RESTART_ATTEMPTS = 10;

export interface BackendInfo {
  name: string;
  port: number;
  repoPath: string;
  healthy: boolean;
  failed: boolean;
  restartCount: number;
}

/**
 * Owns the lifecycle of a single `opencode serve` backend: spawn, probe,
 * supervised restart on unexpected exit (exponential backoff, max 10
 * consecutive attempts), graceful shutdown.
 */
export class ChildSupervisor {
  private child: ChildProcess | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartScheduled = false;
  private consecutiveFailures = 0;
  private shuttingDown = false;
  readonly info: BackendInfo;

  constructor(
    private readonly repo: RepoConfig,
    private readonly port: number,
    private readonly env: Env,
    private readonly log: Logger,
  ) {
    this.info = {
      name: repo.name,
      port,
      repoPath: join(env.REPOS_DIR, repo.name),
      healthy: false,
      failed: false,
      restartCount: 0,
    };
  }

  /**
   * Spawn the backend and wait for its first health report. Does not throw on
   * initial failure — instead kicks off the supervised restart loop so the
   * orchestrator can continue bootstrapping other backends.
   */
  async start(): Promise<void> {
    await this.spawnAndProbe();
  }

  private async spawnAndProbe(): Promise<void> {
    this.spawn();
    try {
      await this.probe();
    } catch (err) {
      this.log.error(
        { err, repo: this.repo.name },
        'Backend health check failed; killing and scheduling restart',
      );
      this.killChild();
      this.scheduleRestart();
    }
  }

  private spawn(): void {
    const {
      OPENCODE_SERVER_PASSWORD: _pw,
      OPENCODE_SERVER_USERNAME: _user,
      ...backendEnv
    } = process.env;
    void _pw;
    void _user;

    this.log.info({ port: this.port }, `Starting opencode serve for "${this.repo.name}"`);
    this.child = spawn(
      'opencode',
      ['serve', '--hostname', BACKEND_HOST, '--port', String(this.port)],
      {
        cwd: this.info.repoPath,
        stdio: 'inherit',
        env: {
          ...backendEnv,
          XDG_CONFIG_HOME: this.env.XDG_CONFIG_HOME,
          XDG_DATA_HOME: this.env.XDG_DATA_HOME,
          XDG_CACHE_HOME: this.env.XDG_CACHE_HOME,
          OPENCODE_DISABLE_AUTOUPDATE: 'true',
        },
      },
    );
    this.child.on('exit', (code, signal) => this.onExit(code, signal));
    this.child.on('error', (err) =>
      this.log.error({ err, repo: this.repo.name }, 'Child process error'),
    );
  }

  private async probe(): Promise<void> {
    await waitForBackend(this.port, this.env.BACKEND_PROBE_PATH, this.log);
    this.info.healthy = true;
    this.consecutiveFailures = 0;
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    this.info.healthy = false;
    if (this.shuttingDown) return;

    this.log.warn(
      { code, signal, repo: this.repo.name },
      'Backend exited unexpectedly; scheduling restart',
    );
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.shuttingDown) return;

    if (this.restartScheduled) return;

    if (this.consecutiveFailures >= MAX_RESTART_ATTEMPTS) {
      this.info.failed = true;
      this.log.error(
        { repo: this.repo.name, attempts: this.consecutiveFailures },
        `Giving up on backend after ${MAX_RESTART_ATTEMPTS} consecutive failures; proxy will return 502`,
      );
      return;
    }
    this.restartScheduled = true;
    this.consecutiveFailures++;
    this.info.restartCount++;
    const delay = Math.min(
      RESTART_INITIAL_DELAY_MS * 2 ** (this.consecutiveFailures - 1),
      RESTART_MAX_DELAY_MS,
    );
    this.log.info(
      { repo: this.repo.name, delay, attempt: this.consecutiveFailures },
      'Scheduling backend restart',
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restartScheduled = false;
      void this.spawnAndProbe();
    }, delay);
  }

  private killChild(): void {
    if (this.child) this.child.kill('SIGTERM');
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.shuttingDown = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.child) this.child.kill(signal);
  }
}
