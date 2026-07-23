import type { ConfigType } from '@nestjs/config';
import type { Mocked } from '@suites/unit';
import type { Request, Response } from 'express';

import { AppConfig } from '@config/app.config';
import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { TestBed } from '@suites/unit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceProxyMiddleware } from './proxy.middleware';

vi.mock('http-proxy-middleware', () => ({
	createProxyMiddleware: vi.fn(),
}));

const appConfig: ConfigType<typeof AppConfig> = {
	healthProbeTimeoutMs: 1_000,
	host: '127.0.0.1',
	port: 3_000,
	proxyBasePath: 'services',
	workspaces: '/workspaces',
};

describe('serviceProxyMiddleware', () => {
	let middleware: ServiceProxyMiddleware;
	let orchestrator: Mocked<OrchestratorService>;
	let proxyHandler: ReturnType<typeof vi.fn>;
	let proxyErrorHandler: ((...args: any[]) => void) | undefined;

	function createRes() {
		return {
			json: vi.fn(),
			status: vi.fn().mockReturnThis(),
		} as unknown as Response;
	}

	function createReq(originalUrl: string, url?: string): Request {
		return { originalUrl, url } as Request;
	}

	beforeEach(async () => {
		proxyHandler = vi.fn();
		const createProxyMiddlewareMock = vi.mocked(createProxyMiddleware);
		createProxyMiddlewareMock.mockImplementation((options: any) => {
			if (options?.on?.error) proxyErrorHandler = options.on.error;
			return proxyHandler as any;
		});

		const { unit, unitRef } = await TestBed.solitary(ServiceProxyMiddleware)
			.mock(AppConfig.KEY)
			.final(appConfig)
			.compile();

		middleware = unit;
		orchestrator = unitRef.get(OrchestratorService);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('route matching', () => {
		it('should call next when URL does not match proxyBasePath', () => {
			const req = createReq('/api/health');
			const res = createRes();
			const next = vi.fn();

			middleware.use(req, res, next);

			expect(next).toHaveBeenCalledTimes(1);
			expect(proxyHandler).not.toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it('should call next when URL starts with proxyBasePath but has no repoId', () => {
			const req = createReq('/services');
			const res = createRes();
			const next = vi.fn();

			middleware.use(req, res, next);

			expect(next).toHaveBeenCalledTimes(1);
		});

		it('should call next when URL is /services/', () => {
			const req = createReq('/services/');
			const res = createRes();
			const next = vi.fn();

			middleware.use(req, res, next);

			expect(next).toHaveBeenCalledTimes(1);
		});
	});

	describe('service not found', () => {
		it('should return 404 when repoId is extracted but port not registered', () => {
			const req = createReq('/services/my-repo/some/path');
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(undefined);

			middleware.use(req, res, next);

			expect(res.status).toHaveBeenCalledWith(404);
			expect(res.json).toHaveBeenCalledWith({ error: 'Service [my-repo] not found' });
			expect(proxyHandler).not.toHaveBeenCalled();
			expect(next).not.toHaveBeenCalled();
		});
	});

	describe('proxy delegation', () => {
		it('should proxy request when repoId matches and port is registered', () => {
			const req = createReq('/services/my-repo/api/endpoint');
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(4_000);

			middleware.use(req, res, next);

			expect(orchestrator.getPort).toHaveBeenCalledWith('my-repo');
			expect(proxyHandler).toHaveBeenCalledWith(req, res, next);
		});

		it('should use originalUrl over url for repoId extraction', () => {
			const req = createReq('/services/from-original', '/some/other/path');
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(5_000);

			middleware.use(req, res, next);

			expect(orchestrator.getPort).toHaveBeenCalledWith('from-original');
		});

		it('should fallback to url when originalUrl is not set', () => {
			const req = { url: '/services/from-url/path' } as Request;
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(5_000);

			middleware.use(req, res, next);

			expect(orchestrator.getPort).toHaveBeenCalledWith('from-url');
		});

		it('should extract first path segment after proxyBasePath as repoId', () => {
			const req = createReq('/services/nested/repo/deep/path');
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(6_000);

			middleware.use(req, res, next);

			expect(orchestrator.getPort).toHaveBeenCalledWith('nested');
		});
	});

	describe('proxy options', () => {
		function getProxyOptions(): any {
			const createProxyMiddlewareMock = vi.mocked(createProxyMiddleware);
			return createProxyMiddlewareMock.mock.lastCall?.[0];
		}

		it('should configure proxy with changeOrigin', () => {
			const options = getProxyOptions();
			expect(options.changeOrigin).toBeTruthy();
		});

		it('should configure pathRewrite to strip proxyBasePath and repoId', () => {
			const options = getProxyOptions();
			expect(options.pathRewrite).toBeDefined();

			const result = options.pathRewrite('/services/my-repo/api/hello');
			expect(result).toBe('/api/hello');
		});

		it('should set router target to host:port from config and orchestrator', () => {
			const options = getProxyOptions();
			const routerFn = options.router as (req: Request) => string;

			orchestrator.getPort.mockReturnValue(8_080);
			const target = routerFn(createReq('/services/test-repo/endpoint'));

			expect(target).toBe('http://127.0.0.1:8080');
		});

		it('should throw in router when port is unavailable', () => {
			orchestrator.getPort.mockReturnValue(undefined);

			const req = createReq('/services/missing-repo/endpoint');
			const res = createRes();
			const next = vi.fn();

			middleware.use(req, res, next);

			expect(res.status).toHaveBeenCalledWith(404);
		});
	});

	describe('error handling', () => {
		it('should return 502 on proxy error', () => {
			const req = createReq('/services/test-repo/path');
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(3_001);

			middleware.use(req, res, next);

			expect(proxyErrorHandler).toBeDefined();
			proxyErrorHandler!({}, req, res);

			expect(res.status).toHaveBeenCalledWith(502);
			expect(res.json).toHaveBeenCalledWith({ error: 'upstream unavailable' });
		});

		it('should not throw when proxy error handler is called without response', () => {
			const req = createReq('/services/test-repo/path');
			const res = createRes();
			const next = vi.fn();

			orchestrator.getPort.mockReturnValue(3_001);

			middleware.use(req, res, next);

			expect(() => proxyErrorHandler!({}, req, null)).not.toThrow();
		});
	});

	describe('custom proxyBasePath', () => {
		it('should work with a custom proxy base path', async () => {
			const customConfig: ConfigType<typeof AppConfig> = {
				healthProbeTimeoutMs: 500,
				host: '127.0.0.1',
				port: 4_000,
				proxyBasePath: 'proxies',
				workspaces: '/workspaces',
			};

			const { unit, unitRef } = await TestBed.solitary(ServiceProxyMiddleware)
				.mock(AppConfig.KEY)
				.final(customConfig)
				.compile();

			const customOrchestrator = unitRef.get(OrchestratorService);
			customOrchestrator.getPort.mockReturnValue(8_000);

			const req = createReq('/proxies/custom-repo/endpoint');
			const res = createRes();
			const next = vi.fn();

			unit.use(req, res, next);

			expect(customOrchestrator.getPort).toHaveBeenCalledWith('custom-repo');
			expect(proxyHandler).toHaveBeenCalledWith(req, res, next);
		});

		it('should escape special regex characters in proxyBasePath', async () => {
			const customConfig: ConfigType<typeof AppConfig> = {
				healthProbeTimeoutMs: 500,
				host: '127.0.0.1',
				port: 4_000,
				proxyBasePath: 'my.services',
				workspaces: '/workspaces',
			};

			const { unit, unitRef } = await TestBed.solitary(ServiceProxyMiddleware)
				.mock(AppConfig.KEY)
				.final(customConfig)
				.compile();

			const customOrchestrator = unitRef.get(OrchestratorService);
			customOrchestrator.getPort.mockReturnValue(8_000);

			const req = createReq('/my.services/escaped-repo/path');
			const res = createRes();
			const next = vi.fn();

			unit.use(req, res, next);

			expect(customOrchestrator.getPort).toHaveBeenCalledWith('escaped-repo');
		});

		it('should not match when proxyBasePath contains special chars and URL does not match', async () => {
			const customConfig: ConfigType<typeof AppConfig> = {
				healthProbeTimeoutMs: 500,
				host: '127.0.0.1',
				port: 4_000,
				proxyBasePath: 'my.services',
				workspaces: '/workspaces',
			};

			const { unit, unitRef } = await TestBed.solitary(ServiceProxyMiddleware)
				.mock(AppConfig.KEY)
				.final(customConfig)
				.compile();

			const customOrchestrator = unitRef.get(OrchestratorService);

			const req = createReq('/myaservices/not-matching/path');
			const res = createRes();
			const next = vi.fn();

			unit.use(req, res, next);

			expect(next).toHaveBeenCalledTimes(1);
			expect(customOrchestrator.getPort).not.toHaveBeenCalled();
		});
	});
});
