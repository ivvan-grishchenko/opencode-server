import type { Logger } from 'pino';

import { bootstrap } from './config/bootstrap.js';
import { parseEnv } from './config/env.js';
import { ProcessManager } from './processes/process-manager.js';
import { ensureGitHubToken, syncAllRepos } from './repos/repo-manager.js';
import { buildApp } from './server/app.js';

/**
 * Orchestrate the full process lifecycle:
 * bootstrap → sync repos → spawn backends → serve proxy → shutdown on signal.
 */
export async function run(rootLog: Logger): Promise<void> {
  const log = rootLog.child({ module: 'orchestrator' });

  const env = parseEnv();
  bootstrap(env);
  ensureGitHubToken(env);

  await syncAllRepos(env.REPOS_JSON, env, log);

  const processManager = new ProcessManager(env, log.child({ module: 'process-manager' }));
  await processManager.startAll(env.REPOS_JSON);

  const app = await buildApp(env, processManager, rootLog);
  await app.listen({ port: Number(env.PORT), host: '0.0.0.0' });

  log.info({ port: env.PORT }, 'Proxy listening on 0.0.0.0');

  for (const b of processManager.listBackends()) {
    log.info(
      { repo: b.name, port: b.port, healthy: b.healthy },
      `/${b.name} -> 127.0.0.1:${b.port}`,
    );
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;

    shuttingDown = true;
    log.info({ signal }, 'Shutting down backends and server');

    processManager.stop(signal);

    void app
      .close()
      .then(() => {
        log.info('Server closed');
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err }, 'Error closing server');
        process.exit(1);
      });
    setTimeout(() => {
      log.warn('Forced exit after 5s timeout');
      process.exit(0);
    }, 5_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
