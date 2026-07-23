import type { MiddlewareConsumer, NestModule } from '@nestjs/common';

import { AppConfig } from '@config/app.config';
import { OpencodeConfig } from '@config/opencode.config';
import { ServiceProxyMiddleware } from '@middleware/proxy.middleware';
import { HealthModule } from '@modules/health/health.module';
import { OrchestratorModule } from '@modules/orchestrator/orchestrator.module';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

@Module({
	imports: [
		ConfigModule.forRoot({ cache: true, isGlobal: true, load: [AppConfig, OpencodeConfig] }),

		HealthModule,
		OrchestratorModule,
	],
	providers: [
		{ provide: APP_PIPE, useClass: ZodValidationPipe },
		{ provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(ServiceProxyMiddleware).forRoutes({ method: RequestMethod.ALL, path: '*splat' });
	}
}
