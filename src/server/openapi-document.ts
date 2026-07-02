import { healthRepoSchema, healthResponseSchema } from './schemas/health-schema.js';

/**
 * Static OpenAPI 3.1 document describing the public surface of this proxy:
 * the unauthenticated `/health` probe and the authenticated `/{repo}/*`
 * reverse-proxy convention. The dynamic per-repo proxy routes are intentionally
 * not enumerated (they are pass-through to each `opencode serve` backend, whose
 * own API is the OpenCode HTTP API).
 */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'OpenCode Server',
    version: '1.0.0',
    description: [
      'Path-based reverse proxy in front of one `opencode serve` backend per GitHub repository.',
      '',
      '## Endpoints',
      '- `GET /health` — unauthenticated liveness probe (Railway/Docker healthcheck).',
      '- `/<repo>/*` — proxied to the matching `opencode serve` backend on localhost.',
      '  All HTTP methods are supported; the `/<repo>` prefix is stripped before forwarding.',
      '',
      '## Authentication',
      'Every route except `/health` requires HTTP Basic Auth',
      '(`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`).',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This deployment' }],
  tags: [
    { name: 'Health', description: 'Liveness and per-backend status' },
    { name: 'Proxy', description: 'Per-repo reverse proxy to an opencode backend' },
  ],
  components: {
    schemas: {
      HealthResponse: healthResponseSchema,
      HealthRepo: healthRepoSchema,
    },
    securitySchemes: {
      basicAuth: {
        type: 'http',
        scheme: 'basic',
        description: 'OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness and per-backend status',
        description:
          'Unauthenticated endpoint used by the Railway/Docker healthcheck. ' +
          'Reports aggregate health plus per-backend restart counts.',
        security: [],
        responses: {
          '200': {
            description: 'Aggregate health of all configured backends',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/{repo}': {
      get: {
        tags: ['Proxy'],
        summary: 'Proxy to an opencode backend',
        description: [
          'Reverse-proxy to the `opencode serve` backend for the named repository.',
          'All HTTP methods (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) and any sub-path',
          'under `/<repo>/*` are forwarded; the `/<repo>` prefix is stripped before',
          'forwarding, so `/<repo>/session` becomes `/session` on the backend.',
        ].join(' '),
        security: [{ basicAuth: [] }],
        parameters: [
          {
            name: 'repo',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The `name` of a repo from `REPOS_JSON`.',
          },
        ],
        responses: {
          '200': {
            description: 'Proxied response from the opencode backend',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': {
            description: 'Missing or invalid Basic Auth credentials',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
          '404': {
            description: 'No backend is configured for the requested repo name',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: { error: { type: 'string' } },
                },
              },
            },
          },
          '502': {
            description: 'Backend unavailable (crashed or failed to start)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error', 'message'],
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
