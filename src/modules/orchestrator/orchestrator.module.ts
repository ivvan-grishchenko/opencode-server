import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { HEALTHCHECK_TIMEOUT_MS } from './orchestrator.constant';
import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';

@Module({
	controllers: [OrchestratorController],
	exports: [OrchestratorService],
	imports: [HttpModule.register({ timeout: HEALTHCHECK_TIMEOUT_MS })],
	providers: [OrchestratorService],
})
export class OrchestratorModule {}
