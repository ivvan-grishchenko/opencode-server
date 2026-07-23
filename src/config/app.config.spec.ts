import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfigType } from './app.config';

import { AppConfig } from './app.config';
import { MAX_PORT } from './config.constant';

const DEFAULT_BASE_PORT = 3_000;
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 1_000;
const defaultWorkspaces = join(process.cwd(), 'workspaces');

describe('appConfig', () => {
	afterEach(() => {
		delete process.env.SERVER_HEALTH_PROBE_TIMEOUT_MS;
		delete process.env.SERVER_HOST;
		delete process.env.SERVER_PORT;
		delete process.env.SERVER_PROXY_BASE_PATH;
		delete process.env.SERVER_WORKSPACES;
	});

	it('should parse and return valid config with env values', () => {
		process.env.SERVER_HEALTH_PROBE_TIMEOUT_MS = '5000';
		process.env.SERVER_HOST = '0.0.0.0';
		process.env.SERVER_PORT = '8080';
		process.env.SERVER_PROXY_BASE_PATH = 'api';
		process.env.SERVER_WORKSPACES = '/custom/workspaces';

		const config = AppConfig() as AppConfigType;

		expect(config).toStrictEqual({
			healthProbeTimeoutMs: 5_000,
			host: '0.0.0.0',
			port: 8_080,
			proxyBasePath: 'api',
			workspaces: '/custom/workspaces',
		});
	});

	it('should apply defaults when env vars are unset', () => {
		const config = AppConfig() as AppConfigType;

		expect(config).toStrictEqual({
			healthProbeTimeoutMs: DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
			host: '127.0.0.1',
			port: DEFAULT_BASE_PORT,
			proxyBasePath: 'services',
			workspaces: defaultWorkspaces,
		});
	});

	it('should coerce string port to number', () => {
		process.env.SERVER_PORT = '4000';

		const config = AppConfig() as AppConfigType;

		expect(config.port).toBe(4_000);
	});

	it('should coerce string healthProbeTimeoutMs to number', () => {
		process.env.SERVER_HEALTH_PROBE_TIMEOUT_MS = '2000';

		const config = AppConfig() as AppConfigType;

		expect(config.healthProbeTimeoutMs).toBe(2_000);
	});

	it('should throw for port below minimum', () => {
		process.env.SERVER_PORT = '0';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should throw for port above MAX_PORT', () => {
		process.env.SERVER_PORT = '65536';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should accept port of 1 (minimum)', () => {
		process.env.SERVER_PORT = '1';

		const config = AppConfig() as AppConfigType;

		expect(config.port).toBe(1);
	});

	it('should accept port of MAX_PORT', () => {
		process.env.SERVER_PORT = String(MAX_PORT);

		const config = AppConfig() as AppConfigType;

		expect(config.port).toBe(MAX_PORT);
	});

	it('should throw for non-positive healthProbeTimeoutMs', () => {
		process.env.SERVER_HEALTH_PROBE_TIMEOUT_MS = '0';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should throw for non-integer healthProbeTimeoutMs', () => {
		process.env.SERVER_HEALTH_PROBE_TIMEOUT_MS = '1.5';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should throw for empty host', () => {
		process.env.SERVER_HOST = '';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should throw for empty proxyBasePath', () => {
		process.env.SERVER_PROXY_BASE_PATH = '';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});

	it('should throw for empty workspaces', () => {
		process.env.SERVER_WORKSPACES = '';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => AppConfig()).toThrow();
	});
});
