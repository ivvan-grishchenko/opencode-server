import type { NestMiddleware } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import { AppConfig } from '@config/app.config';
// oxlint-disable-next-line typescript/consistent-type-imports
import { OrchestratorService } from '@modules/orchestrator/orchestrator.service';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type RequestHandler, createProxyMiddleware } from 'http-proxy-middleware';

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

@Injectable()
export class ServiceProxyMiddleware implements NestMiddleware {
	private readonly proxy: RequestHandler;
	private readonly servicePathRegex: RegExp;

	constructor(
		@Inject(AppConfig.KEY)
		private readonly appConfig: ConfigType<typeof AppConfig>,

		private readonly orchestrator: OrchestratorService
	) {
		this.servicePathRegex = new RegExp(`^/${escapeRegExp(this.appConfig.proxyBasePath)}/([^/]+)`);

		this.proxy = createProxyMiddleware({
			changeOrigin: true,
			on: {
				error: (_err, _req, res) => {
					if (res && typeof (res as Response).status === 'function')
						(res as Response)
							.status(HttpStatus.BAD_GATEWAY)
							.json({ error: 'upstream unavailable' });
				},
			},
			pathRewrite: (rewritePath) => rewritePath.replace(this.servicePathRegex, ''),
			router: (req) => {
				const repoId = this.repoId(req as Request);
				const port = this.orchestrator.getPort(repoId);

				if (!port) throw new Error(`Service [${repoId}] is offline`);

				return `http://${this.appConfig.host}:${port}`;
			},
		});
	}

	use(req: Request, res: Response, next: NextFunction): void {
		const repoId = this.repoId(req);

		if (!repoId) {
			next();
			return;
		}

		if (!this.orchestrator.getPort(repoId)) {
			res.status(HttpStatus.NOT_FOUND).json({ error: `Service [${repoId}] not found` });
			return;
		}

		void this.proxy(req, res, next);
	}

	private repoId(req: Request): string {
		const source = req.originalUrl ?? req.url;

		return source.match(this.servicePathRegex)?.[1] ?? '';
	}
}
