import type { FastifyInstance } from 'fastify';

import type { ProcessManager } from '../../processes/process-manager.js';
import { healthResponseSchema } from '../schemas/health-schema.js';

/**
 * Unauthenticated liveness endpoint used by the Railway / Docker healthcheck.
 * Returns per-backend health so operators can see which repos are up.
 */
export function registerHealthRoute(app: FastifyInstance, processManager: ProcessManager): void {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => {
      const backends = processManager.listBackends();
      return {
        healthy: backends.every((b) => b.healthy),
        repos: backends.map((b) => ({
          name: b.name,
          healthy: b.healthy,
          failed: b.failed,
          restartCount: b.restartCount,
        })),
      };
    },
  );
}
