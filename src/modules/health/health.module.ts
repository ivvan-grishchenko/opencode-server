import { OrchestratorModule } from '@modules/orchestrator/orchestrator.module';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
	controllers: [HealthController],
	imports: [OrchestratorModule, TerminusModule, HttpModule],
	providers: [HealthService],
})
export class HealthModule {}
