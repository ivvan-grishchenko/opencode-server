import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { AppConfig } from '@config/app.config';
import { OpencodeConfig } from '@config/opencode.config';
import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer } from 'node:http';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';

const DEAD_PORT = 9_999;
const HOOK_TIMEOUT = 15_000;

// oxlint-disable-next-line promise/avoid-new
function createUpstream(
	handler?: (url: string) => void
): Promise<{ port: number; server: Server }> {
	// oxlint-disable-next-line promise/avoid-new
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let body = '';
			req.on('data', (chunk: Buffer) => (body += chunk.toString()));
			req.on('end', () => {
				handler?.(req.url ?? '/');
				res.writeHead(HttpStatus.OK, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						body: body || null,
						method: req.method,
						url: req.url,
					})
				);
			});
		});
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (typeof address === 'object' && address) resolve({ port: address.port, server });
			else resolve({ port: 0, server });
		});
	});
}

describe('proxy e2e', () => {
	// oxlint-disable-next-line init-declarations
	let app: INestApplication;
	// oxlint-disable-next-line init-declarations
	let request: supertest.Agent;
	// oxlint-disable-next-line init-declarations
	let mockOrchestrator: Record<string, ReturnType<typeof vi.fn>>;

	const defaultAppConfig = {
		healthProbeTimeoutMs: 1_000,
		host: '127.0.0.1',
		port: 3_000,
		proxyBasePath: 'services',
		workspaces: '/workspaces',
	};

	const defaultOpencodeConfig = {
		apiKey: 'test-api-key',
		password: 'test-password',
		username: 'test-user',
	};

	beforeAll(async () => {
		mockOrchestrator = {
			getPort: vi.fn().mockReturnValue(undefined),
			listInstances: vi.fn().mockReturnValue([]),
			startRepository: vi.fn(),
			stopRepository: vi.fn().mockResolvedValue(false),
		};

		const moduleFixture = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(OrchestratorService)
			.useValue(mockOrchestrator)
			.overrideProvider(AppConfig.KEY)
			.useValue(defaultAppConfig)
			.overrideProvider(OpencodeConfig.KEY)
			.useValue(defaultOpencodeConfig)
			.compile();

		app = moduleFixture.createNestApplication();
		await app.init();
		request = supertest(app.getHttpServer());
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockOrchestrator.getPort.mockReturnValue(undefined);
		mockOrchestrator.listInstances.mockReturnValue([]);
	});

	afterAll(async () => {
		await app.close();
	}, HOOK_TIMEOUT);

	describe('passthrough routes', () => {
		it('should pass through non-proxied URLs to controllers', async () => {
			const res = await request.get('/orchestrator/instances');
			expect(res.status).toBe(HttpStatus.OK);
			expect(res.body).toStrictEqual([]);
		});

		it('should pass through health check endpoint', async () => {
			const res = await request.get('/health');
			expect(res.status).toBe(HttpStatus.OK);
			expect(res.body.status).toBe('ok');
		});

		it('should return 404 for unknown non-proxied routes', async () => {
			const res = await request.get('/nonexistent/route');
			expect(res.status).toBe(HttpStatus.NOT_FOUND);
		});
	});

	describe('unknown repo', () => {
		it('should return 404 when repo is not registered', async () => {
			mockOrchestrator.getPort.mockReturnValue(undefined);

			const res = await request.get('/services/unknown-repo/some/path');

			expect(res.status).toBe(HttpStatus.NOT_FOUND);
			expect(res.body).toStrictEqual({ error: 'Service [unknown-repo] not found' });
		});

		it('should return 404 for POST requests to unknown repo', async () => {
			mockOrchestrator.getPort.mockReturnValue(undefined);

			const res = await request.post('/services/unknown-repo/api/data').send({ key: 'value' });

			expect(res.status).toBe(HttpStatus.NOT_FOUND);
			expect(res.body).toStrictEqual({ error: 'Service [unknown-repo] not found' });
		});
	});

	describe('proxy to upstream', () => {
		let upstream: { port: number; server: Server } | null = null;

		afterEach(async () => {
			if (upstream) {
				// oxlint-disable-next-line promise/avoid-new
				await new Promise<void>((resolve) => upstream!.server.close(() => resolve()));
				upstream = null;
			}
		});

		it('should proxy GET request to upstream and return response', async () => {
			upstream = await createUpstream();
			mockOrchestrator.getPort.mockReturnValue(upstream.port);

			const res = await request.get('/services/my-repo/api/hello?foo=bar');

			expect(res.status).toBe(HttpStatus.OK);
			expect(res.body.url).toBe('/api/hello?foo=bar');
			expect(res.body.method).toBe('GET');
		});

		it('should proxy POST request to upstream', async () => {
			upstream = await createUpstream();
			mockOrchestrator.getPort.mockReturnValue(upstream.port);

			const res = await request.post('/services/my-repo/api/submit');

			expect(res.status).toBe(HttpStatus.OK);
			expect(res.body.url).toBe('/api/submit');
			expect(res.body.method).toBe('POST');
		});

		it('should strip proxyBasePath and repoId from proxied path', async () => {
			const capturedUrls: string[] = [];
			upstream = await createUpstream((url) => capturedUrls.push(url));
			mockOrchestrator.getPort.mockReturnValue(upstream.port);

			await request.get('/services/strip-repo/nested/deep/path');

			expect(capturedUrls[0]).toBe('/nested/deep/path');
		});

		it('should proxy root path after prefix', async () => {
			const capturedUrls: string[] = [];
			upstream = await createUpstream((url) => capturedUrls.push(url));
			mockOrchestrator.getPort.mockReturnValue(upstream.port);

			await request.get('/services/root-repo/');

			expect(capturedUrls[0]).toBe('/');
		});
	});

	describe('upstream error handling', () => {
		it('should return 502 when upstream is unreachable', async () => {
			mockOrchestrator.getPort.mockReturnValue(DEAD_PORT);

			const res = await request.get('/services/dead-repo/some/path');

			expect(res.status).toBe(HttpStatus.BAD_GATEWAY);
			expect(res.body).toStrictEqual({ error: 'upstream unavailable' });
		});
	});

	describe('custom proxyBasePath', () => {
		it('should use custom proxyBasePath from config', async () => {
			const customApp = await Test.createTestingModule({
				imports: [AppModule],
			})
				.overrideProvider(OrchestratorService)
				.useValue(mockOrchestrator)
				.overrideProvider(AppConfig.KEY)
				.useValue({ ...defaultAppConfig, proxyBasePath: 'api' })
				.overrideProvider(OpencodeConfig.KEY)
				.useValue(defaultOpencodeConfig)
				.compile();

			const customNestApp = customApp.createNestApplication();
			await customNestApp.init();
			const customRequest = supertest(customNestApp.getHttpServer());

			const upstream = await createUpstream();
			mockOrchestrator.getPort.mockReturnValue(upstream.port);

			const res = await customRequest.get('/api/custom-repo/endpoint');

			expect(res.status).toBe(HttpStatus.OK);
			expect(res.body.url).toBe('/endpoint');

			// oxlint-disable-next-line promise/avoid-new
			await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
			await customNestApp.close();
		});

		it('should passthrough when URL uses old proxyBasePath after config change', async () => {
			const customApp = await Test.createTestingModule({
				imports: [AppModule],
			})
				.overrideProvider(OrchestratorService)
				.useValue(mockOrchestrator)
				.overrideProvider(AppConfig.KEY)
				.useValue({ ...defaultAppConfig, proxyBasePath: 'api' })
				.overrideProvider(OpencodeConfig.KEY)
				.useValue(defaultOpencodeConfig)
				.compile();

			const customNestApp = customApp.createNestApplication();
			await customNestApp.init();
			const customRequest = supertest(customNestApp.getHttpServer());

			mockOrchestrator.getPort.mockReturnValue(undefined);

			const res = await customRequest.get('/services/some-repo/path');

			expect(res.status).toBe(HttpStatus.NOT_FOUND);

			await customNestApp.close();
		});
	});
});
