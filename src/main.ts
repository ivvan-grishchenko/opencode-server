import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppConfig } from '@config/app.config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);

	const appConfig: ConfigType<typeof AppConfig> = app.get(AppConfig.KEY);

	const swaggerConfig = new DocumentBuilder()
		.setTitle('Opencode Proxy Server API')
		.setDescription(
			'API for managing per-repository backends. Start, stop, list, and check the status of repository instances proxied through the opencode server.'
		)
		.setVersion('1.0.0')
		.setContact('Grishchenko, Ivan', 'https://github.com/ivvan-grishchenko', 'bben.rasha@gmail.com')
		.addServer(`http://${appConfig.host}:${appConfig.port}`, 'Local development server')
		.build();
	const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
	const cleanedSwaggerDocument = cleanupOpenApiDoc(swaggerDocument);

	app.use('/docs', apiReference({ content: cleanedSwaggerDocument }));

	app.enableShutdownHooks();
	await app.listen(appConfig.port);
}

// oxlint-disable-next-line vitest/require-hook promise/prefer-await-to-then
bootstrap().catch(() => {
	process.exit(1);
});
