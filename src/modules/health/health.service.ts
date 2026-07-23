// oxlint-disable typescript/consistent-type-imports
import type { ConfigType } from '@nestjs/config';
import type { HealthIndicatorResult } from '@nestjs/terminus';

import { AppConfig } from '@config/app.config';
import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class HealthService {
	constructor(
		@Inject(AppConfig.KEY)
		private readonly appConfig: ConfigType<typeof AppConfig>,

		private readonly orchestratorService: OrchestratorService,

		private readonly healthIndicatorService: HealthIndicatorService,
		private readonly httpService: HttpService
	) {}

	async isHealthy(key: string): Promise<HealthIndicatorResult> {
		const indicator = this.healthIndicatorService.check(key);
		const port = this.orchestratorService.getPort(key);

		if (!port) return indicator.down({ reason: 'not started' });

		const reachable = await this.probe(port);

		return reachable ? indicator.up() : indicator.down({ reason: 'unreachable' });
	}

	private async probe(port: number): Promise<boolean> {
		try {
			const url = `http://${this.appConfig.host}:${port}/global/health`;
			const response = await firstValueFrom(this.httpService.get<{ healthy: boolean }>(url));
			return response.data.healthy;
		} catch {
			return false;
		}
	}
}
