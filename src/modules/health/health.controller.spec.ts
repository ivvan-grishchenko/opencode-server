// oxlint-disable typescript/consistent-type-imports
import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { HealthCheckService } from '@nestjs/terminus';
import { Mocked, TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('healthController', () => {
	let controller: HealthController;
	let health: Mocked<HealthService>;
	let orchestrator: Mocked<OrchestratorService>;
	let healthCheckService: Mocked<HealthCheckService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(HealthController).compile();

		controller = unit;
		health = unitRef.get(HealthService);
		orchestrator = unitRef.get(OrchestratorService);
		healthCheckService = unitRef.get(HealthCheckService);
	});

	afterEach(() => vi.resetAllMocks());

	describe('healthCheck', () => {
		it('should call orchestrator.listInstances() to build health checks', async () => {
			orchestrator.listInstances.mockReturnValue([]);
			await healthCheckService.check.mockResolvedValue({ details: {}, status: 'ok' });

			await controller.healthCheck();

			expect(orchestrator.listInstances).toHaveBeenCalledTimes(1);
		});

		it('should pass a health check function per instance to healthCheckService.check', async () => {
			const instances = [
				{ name: 'repo-a', port: 3_001, workspacePath: '/ws/a' },
				{ name: 'repo-b', port: 3_002, workspacePath: '/ws/b' },
			];
			orchestrator.listInstances.mockReturnValue(instances);
			await healthCheckService.check.mockResolvedValue({ details: {}, status: 'ok' });

			await controller.healthCheck();

			expect(healthCheckService.check).toHaveBeenCalledTimes(1);
			const checks = healthCheckService.check.mock.calls[0]![0] as Function[];
			expect(checks).toHaveLength(2);
		});

		it('should invoke health.isHealthy with each instance name', async () => {
			const instances = [
				{ name: 'repo-a', port: 3_001, workspacePath: '/ws/a' },
				{ name: 'repo-b', port: 3_002, workspacePath: '/ws/b' },
			];
			orchestrator.listInstances.mockReturnValue(instances);
			await healthCheckService.check.mockImplementation(async (fns: Function[]) => {
				for (const fn of fns) await fn();
				return { details: {}, status: 'ok' };
			});
			await health.isHealthy.mockResolvedValue({ repo_a: { status: 'up' } });

			await controller.healthCheck();

			expect(health.isHealthy).toHaveBeenCalledWith('repo-a');
			expect(health.isHealthy).toHaveBeenCalledWith('repo-b');
		});

		it('should return the result from healthCheckService.check', async () => {
			const expected = { details: { 'repo-a': { status: 'up' } }, status: 'ok' } as any;
			orchestrator.listInstances.mockReturnValue([
				{ name: 'repo-a', port: 3_001, workspacePath: '/ws/a' },
			]);
			await healthCheckService.check.mockResolvedValue(expected);

			const result = await controller.healthCheck();

			expect(result).toBe(expected);
		});

		it('should handle zero instances gracefully', async () => {
			orchestrator.listInstances.mockReturnValue([]);
			await healthCheckService.check.mockResolvedValue({ details: {}, status: 'ok' });

			const result = await controller.healthCheck();

			expect(healthCheckService.check).toHaveBeenCalledWith([]);
			expect(result).toStrictEqual({ details: {}, status: 'ok' });
			expect(health.isHealthy).not.toHaveBeenCalled();
		});
	});
});
