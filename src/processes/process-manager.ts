import type { Logger } from 'pino';

import type { Env, RepoConfig } from '../config/env.js';
import { ChildSupervisor, type BackendInfo } from './child-supervisor.js';

const BACKEND_BASE_PORT = 5000;

/**
 * Owns all {@link ChildSupervisor} instances and the name → {@link BackendInfo}
 * map consulted by the proxy and health route.
 */
export class ProcessManager {
  private readonly supervisors: ChildSupervisor[] = [];
  readonly backends = new Map<string, BackendInfo>();

  constructor(
    private readonly env: Env,
    private readonly log: Logger,
  ) {}

  getBackend(name: string): BackendInfo | undefined {
    return this.backends.get(name);
  }

  listBackends(): BackendInfo[] {
    return [...this.backends.values()];
  }

  /**
   * Start backends sequentially (one at a time) to avoid SQLite database-lock
   * races when multiple opencode processes share the same XDG_DATA_HOME.
   * Each supervisor's {@link ChildSupervisor.start} is non-throwing, so a
   * single broken backend does not block the rest.
   */
  async startAll(repos: RepoConfig[]): Promise<void> {
    this.log.info({ count: repos.length }, 'Bootstrapping backend services');
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      const port = BACKEND_BASE_PORT + i;
      const supervisor = new ChildSupervisor(
        repo,
        port,
        this.env,
        this.log.child({ repo: repo.name }),
      );
      this.supervisors.push(supervisor);
      this.backends.set(repo.name, supervisor.info);
      await supervisor.start();
      this.log.info(
        { repo: repo.name, port, healthy: supervisor.info.healthy },
        `Backend start attempt complete (healthy=${supervisor.info.healthy})`,
      );
    }
    this.log.info('All backend start attempts finished');
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const supervisor of this.supervisors) {
      supervisor.stop(signal);
    }
  }
}
