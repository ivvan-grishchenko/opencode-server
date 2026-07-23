import { registerAs } from '@nestjs/config';
import { join } from 'node:path';
import { z } from 'zod';

import { MAX_PORT } from './config.constant';
import { ConfigTokenEnum } from './config.enum';

const DEFAULT_BASE_PORT = 3_000;
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 1_000;

const AppConfigSchema = z.object({
	healthProbeTimeoutMs: z.coerce.number().int().positive().default(DEFAULT_HEALTH_PROBE_TIMEOUT_MS),
	host: z.string().min(1).default('127.0.0.1'),
	port: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_BASE_PORT),
	proxyBasePath: z.string().min(1).default('services'),
	// oxlint-disable-next-line unicorn/max-nested-calls
	workspaces: z.string().min(1).default(join(process.cwd(), 'workspaces')),
});

type AppConfigType = z.infer<typeof AppConfigSchema>;

const AppConfig = registerAs<AppConfigType>(ConfigTokenEnum.APP, () =>
	AppConfigSchema.parse({
		healthProbeTimeoutMs: process.env.SERVER_HEALTH_PROBE_TIMEOUT_MS,
		host: process.env.SERVER_HOST,
		port: process.env.SERVER_PORT,
		proxyBasePath: process.env.SERVER_PROXY_BASE_PATH,
		workspaces: process.env.SERVER_WORKSPACES,
	})
);

export type { AppConfigType };
export { AppConfig };
