import { afterEach, describe, expect, it } from 'vitest';

import type { OpencodeConfigType } from './opencode.config';

import { OpencodeConfig } from './opencode.config';

describe('opencodeConfig', () => {
	afterEach(() => {
		delete process.env.OPENCODE_API_KEY;
		delete process.env.OPENCODE_SERVER_PASSWORD;
		delete process.env.OPENCODE_SERVER_USERNAME;
	});

	it('should parse and return valid config with env values', () => {
		process.env.OPENCODE_API_KEY = 'test-api-key';
		process.env.OPENCODE_SERVER_PASSWORD = 'test-password';
		process.env.OPENCODE_SERVER_USERNAME = 'custom-user';

		const config = OpencodeConfig() as OpencodeConfigType;

		expect(config).toStrictEqual({
			apiKey: 'test-api-key',
			password: 'test-password',
			username: 'custom-user',
		});
	});

	it('should default username to "opencode" when not set', () => {
		process.env.OPENCODE_API_KEY = 'test-api-key';
		process.env.OPENCODE_SERVER_PASSWORD = 'test-password';

		const config = OpencodeConfig() as OpencodeConfigType;

		expect(config).toStrictEqual({
			apiKey: 'test-api-key',
			password: 'test-password',
			username: 'opencode',
		});
	});

	it('should throw for missing apiKey', () => {
		process.env.OPENCODE_SERVER_PASSWORD = 'password';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});

	it('should throw for empty apiKey', () => {
		process.env.OPENCODE_API_KEY = '';
		process.env.OPENCODE_SERVER_PASSWORD = 'password';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});

	it('should throw for missing password', () => {
		process.env.OPENCODE_API_KEY = 'key';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});

	it('should throw for empty password', () => {
		process.env.OPENCODE_API_KEY = 'key';
		process.env.OPENCODE_SERVER_PASSWORD = '';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});

	it('should throw for empty username', () => {
		process.env.OPENCODE_API_KEY = 'key';
		process.env.OPENCODE_SERVER_PASSWORD = 'password';
		process.env.OPENCODE_SERVER_USERNAME = '';

		// oxlint-disable-next-line vitest/require-to-throw-message
		expect(() => OpencodeConfig()).toThrow();
	});
});
