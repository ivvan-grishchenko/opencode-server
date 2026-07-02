import scalarApiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';

import { openApiDocument } from '../openapi-document.js';

/**
 * Register the Scalar API Reference UI at `/reference` and serve the raw
 * OpenAPI spec at `/reference/openapi.json` (+ `.yaml`). The spec is embedded
 * inline (no `@fastify/swagger` and no spec-fetch round-trip), so the reference
 * page renders even though `/reference` sits behind the Basic Auth hook.
 */
export async function registerScalarDocs(app: FastifyInstance): Promise<void> {
  await app.register(scalarApiReference, {
    routePrefix: '/reference',
    logLevel: 'warn',
    configuration: {
      title: 'OpenCode Server',
      theme: 'purple',
      content: openApiDocument,
    },
  });
}
