import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';

import type { Env } from '../config/env.js';
import type { ProcessManager } from '../processes/process-manager.js';
import { registerBasicAuth } from './plugins/basic-auth.plugin.js';
import { registerProxies } from './plugins/proxy.plugin.js';
import { registerScalarDocs } from './plugins/scalar.plugin.js';
import { registerHealthRoute } from './routes/health.route.js';

/**
 * Build the public Fastify server: Basic Auth + per-repo proxy + health route.
 *
 * `loggerInstance` (not `logger`) is used because we pass an existing pino
 * instance; `logger` only accepts a configuration object in Fastify 5. The
 * param is typed as `FastifyBaseLogger` (not pino's `Logger`) so Fastify's
 * inferred `Logger` generic stays broad and its internal `.child()` results
 * remain assignable. The root logger is passed so request logs don't inherit
 * orchestrator child bindings.
 */
export async function buildApp(
  env: Env,
  processManager: ProcessManager,
  logger: FastifyBaseLogger,
): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  await registerBasicAuth(app, env);
  registerHealthRoute(app, processManager);
  registerProxies(app, processManager.listBackends());
  await registerScalarDocs(app);

  const repoNames = new Set(processManager.listBackends().map((b) => b.name));

  app.setNotFoundHandler((req, reply) => {
    const firstSegment = req.url.split('?')[0].split('/')[1];
    reply.code(404).send({ error: `Repo "${firstSegment}" not found` });
  });

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    if (err.statusCode === 401) {
      reply
        .code(401)
        .header('WWW-Authenticate', 'Basic realm="opencode"')
        .send({ error: 'Unauthorized' });
      return;
    }

    const firstSegment = req.url.split('?')[0].split('/')[1];

    if (repoNames.has(firstSegment)) {
      app.log.error({ err, repo: firstSegment }, 'Proxy error');
      reply.code(502).send({ error: 'Backend unavailable', message: err.message });

      return;
    }

    app.log.error({ err }, 'Unhandled error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  return app;
}
