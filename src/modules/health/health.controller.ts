// oxlint-disable typescript/consistent-type-imports
import type { HealthCheckResult, HealthIndicatorResult } from '@nestjs/terminus';

import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { HealthService } from './health.service';

@ApiTags('health')
@ApiBearerAuth('access-token')
@Controller('health')
export class HealthController {
	constructor(
		private readonly health: HealthService,
		private readonly orchestrator: OrchestratorService,

		private readonly healthCheckService: HealthCheckService
	) {}

	@Get()
	@ApiOperation({
		description:
			'Performs a health check against all running repository instances and returns their collective status.',
		summary: 'Health check',
	})
	@ApiResponse({ description: 'The Health Check is successful', status: 200 })
	@ApiResponse({ description: 'The Health Check is not successful', status: 503 })
	@HealthCheck()
	healthCheck(): Promise<HealthCheckResult<HealthIndicatorResult>> {
		const checks = this.orchestrator
			.listInstances()
			.map((instance) => () => this.health.isHealthy(instance.name));

		return this.healthCheckService.check(checks);
	}
}
