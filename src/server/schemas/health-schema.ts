/**
 * JSON Schema for the `/health` response. Single source of truth shared by the
 * Fastify route (runtime serialization) and the static OpenAPI document.
 *
 * The response schema inlines the repo shape (rather than using `$ref`) so it
 * is self-contained for `fast-json-stringify`, which resolves refs only within
 * the schema object passed to a route (there is no `components` there). The
 * OpenAPI document keeps `HealthRepo` as a named component for readability.
 */
export const healthRepoSchema = {
  type: 'object',
  required: ['name', 'healthy', 'failed', 'restartCount'],
  properties: {
    name: { type: 'string', description: 'Repo path segment (`/<name>/...`)' },
    healthy: { type: 'boolean', description: 'Backend reports healthy on the probe path' },
    failed: {
      type: 'boolean',
      description: 'Supervisor gave up after 10 consecutive restart failures',
    },
    restartCount: {
      type: 'integer',
      description: 'Total supervised restarts attempted for this backend',
    },
  },
} as const;

export const healthResponseSchema = {
  type: 'object',
  required: ['healthy', 'repos'],
  properties: {
    healthy: {
      type: 'boolean',
      description: 'true only if every configured backend reports healthy',
    },
    repos: {
      type: 'array',
      description: 'One entry per configured repository',
      items: healthRepoSchema,
    },
  },
} as const;
