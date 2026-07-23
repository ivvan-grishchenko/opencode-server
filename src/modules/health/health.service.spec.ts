import type { ConfigType } from '@nestjs/config';
import type { Mocked } from '@suites/unit';

import { AppConfig } from '@config/app.config';
import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { HttpService } from '@nestjs/axios';
import { HealthIndicatorService } from '@nestjs/terminus';
import { TestBed } from '@suites/unit';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service';

describe('healthService', () => {
	const appConfig: ConfigType<typeof AppConfig> = {
		healthProbeTimeoutMs: 1_000,
		host: 'https://example.com',
		port: 3_000,
		proxyBasePath: '/proxy',
		workspaces: '/workspaces',
	};

	let service: HealthService;
	let orchestratorService: Mocked<OrchestratorService>;
	let healthIndicatorService: Mocked<HealthIndicatorService>;
	let httpService: Mocked<HttpService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(HealthService)
			.mock(AppConfig.KEY)
			.final(appConfig)
			.compile();

		service = unit;
		orchestratorService = unitRef.get(OrchestratorService);
		healthIndicatorService = unitRef.get(HealthIndicatorService);
		httpService = unitRef.get(HttpService);
	});

	afterEach(() => vi.resetAllMocks());

	describe('isHealthy', () => {
		const key = 'my-repo';
		const indicator = { down: vi.fn(), up: vi.fn() };

		beforeEach(() => {
			healthIndicatorService.check.mockReturnValue(indicator as any);
			indicator.up.mockReturnValue({ [key]: { status: 'up' } });
			indicator.down.mockReturnValue({ [key]: { status: 'down' } });
		});

		it('should call healthIndicatorService.check with the given key', async () => {
			orchestratorService.getPort.mockReturnValue(undefined);

			await service.isHealthy(key);

			expect(healthIndicatorService.check).toHaveBeenCalledWith(key);
		});

		it('should return indicator.down when port is undefined', async () => {
			orchestratorService.getPort.mockReturnValue(undefined);

			const result = await service.isHealthy(key);

			expect(orchestratorService.getPort).toHaveBeenCalledWith(key);
			expect(indicator.down).toHaveBeenCalledWith({ reason: 'not started' });
			expect(result).toStrictEqual({ [key]: { status: 'down' } });
		});

		it('should return indicator.down when port is 0', async () => {
			orchestratorService.getPort.mockReturnValue(0);

			const result = await service.isHealthy(key);

			expect(indicator.down).toHaveBeenCalledWith({ reason: 'not started' });
			expect(result).toStrictEqual({ [key]: { status: 'down' } });
		});

		it('should probe the health endpoint when port is available', async () => {
			orchestratorService.getPort.mockReturnValue(4_000);
			httpService.get.mockReturnValue(of({ data: { healthy: true } }) as any);

			await service.isHealthy(key);

			expect(httpService.get).toHaveBeenCalledWith(
				`http://${appConfig.host}:${4_000}/global/health`
			);
		});

		it('should return indicator.up when probe succeeds and response is healthy', async () => {
			orchestratorService.getPort.mockReturnValue(4_000);
			httpService.get.mockReturnValue(of({ data: { healthy: true } }) as any);

			const result = await service.isHealthy(key);

			expect(indicator.up).toHaveBeenCalledTimes(1);
			expect(result).toStrictEqual({ [key]: { status: 'up' } });
		});

		it('should return indicator.down when probe succeeds but response is not healthy', async () => {
			orchestratorService.getPort.mockReturnValue(4_000);
			httpService.get.mockReturnValue(of({ data: { healthy: false } }) as any);

			const result = await service.isHealthy(key);

			expect(indicator.down).toHaveBeenCalledWith({ reason: 'unreachable' });
			expect(result).toStrictEqual({ [key]: { status: 'down' } });
		});

		it('should return indicator.down when probe throws an error', async () => {
			orchestratorService.getPort.mockReturnValue(4_000);
			httpService.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')) as any);

			const result = await service.isHealthy(key);

			expect(indicator.down).toHaveBeenCalledWith({ reason: 'unreachable' });
			expect(result).toStrictEqual({ [key]: { status: 'down' } });
		});
	});
});
