import { z } from 'zod';

const RepoSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default('main'),
});

const ReposJsonSchema = z.string().transform((raw, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'REPOS_JSON must be valid JSON',
    });
    return z.NEVER;
  }
  const result = z.array(RepoSchema).min(1).safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `REPOS_JSON[${issue.path.join('.')}] ${issue.message}`,
      });
    }
    return z.NEVER;
  }
  return result.data;
});

export const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  OPENCODE_API_KEY: z.string().min(1),
  OPENCODE_SERVER_PASSWORD: z.string().min(1),
  OPENCODE_SERVER_USERNAME: z.string().min(1).default('opencode'),
  REPOS_JSON: ReposJsonSchema,
  REPOS_DIR: z.string().min(1).default('/data/repos'),
  XDG_CONFIG_HOME: z.string().min(1).default('/data/config'),
  XDG_DATA_HOME: z.string().min(1).default('/data/local'),
  XDG_CACHE_HOME: z.string().min(1).default('/data/cache'),
  PORT: z.string().min(1).default('3000'),
  BACKEND_PROBE_PATH: z.string().min(1).default('/app'),
  OPENCODE_CONFIG_CONTENT: z.string().optional(),
  LOG_LEVEL: z.string().min(1).default('info'),
  NODE_ENV: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;
export type RepoConfig = z.infer<typeof RepoSchema>;

export function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    console.error(
      'Example REPOS_JSON: [{"name":"repo-a","owner":"myorg","repo":"repo-a","branch":"main"}]',
    );
    process.exit(1);
  }
  return result.data;
}
