import basicAuth from '@fastify/basic-auth';
import type { FastifyInstance } from 'fastify';

import type { Env } from '../../config/env.js';

/**
 * Register HTTP Basic Auth. A single `onRequest` hook enforces auth on every
 * route except `/health`, so even 404 responses for unknown repos remain behind
 * auth (matching the original proxy's behaviour).
 */
export async function registerBasicAuth(app: FastifyInstance, env: Env): Promise<void> {
  const validate = async (username: string, password: string) => {
    if (username !== env.OPENCODE_SERVER_USERNAME || password !== env.OPENCODE_SERVER_PASSWORD) {
      throw new Error('Unauthorized');
    }
  };

  await app.register(basicAuth, {
    validate,
    authenticate: { realm: 'opencode' },
  });

  app.addHook('onRequest', (req, reply, done) => {
    const firstSegment = req.url.split('?')[0].split('/')[1];
    if (firstSegment === 'health') {
      done();
      return;
    }
    app.basicAuth(req, reply, done);
  });
}
