import httpProxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';

import type { BackendInfo } from '../../processes/child-supervisor.js';

/**
 * Register one `@fastify/http-proxy` instance per repo. The prefix is stripped
 * before forwarding, so `/repo-a/session` becomes `/session` on the backend.
 */
export function registerProxies(app: FastifyInstance, backends: BackendInfo[]): void {
  for (const backend of backends) {
    app.register(httpProxy, {
      upstream: `http://127.0.0.1:${backend.port}`,
      prefix: `/${backend.name}`,
    });
  }
}
