import type { ConfigType } from '@nestjs/config';

import { AppConfig } from '@config/app.config';
import { OpencodeConfig } from '@config/opencode.config';
// oxlint-disable-next-line typescript/consistent-type-imports
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import ms from 'ms';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import portfinder from 'portfinder';
import { firstValueFrom } from 'rxjs';

import type { RepositoryStartDTO } from './dto/repo.dto';
import type { ActiveInstance } from './orchestrator.type';

@Injectable()
export class OrchestratorService {
	private readonly logger = new Logger(OrchestratorService.name);
	private readonly instances = new Map<string, ActiveInstance>();

	private readonly TIMEOUT_MS = ms('2m');
	private readonly HEALTHCHECK_TIMEOUT_MS = ms('30s');

	constructor(
		@Inject(AppConfig.KEY)
		private readonly appConfig: ConfigType<typeof AppConfig>,
		@Inject(OpencodeConfig.KEY)
		private readonly opencodeConfig: ConfigType<typeof OpencodeConfig>,

		private readonly httpService: HttpService
	) {
		portfinder.basePort = this.appConfig.port;
	}

	getPort(id: string): number | undefined {
		return this.instances.get(id)?.port;
	}

	async startRepository(repo: RepositoryStartDTO): Promise<void> {
		const existingInstance = this.instances.get(repo.name);

		if (existingInstance) {
			this.logger.log(
				`[${repo.name}] Repository is already running on port ${existingInstance.port}`
			);
			return;
		}

		await this.bootstrapService(repo);
	}

	private async bootstrapService(repo: RepositoryStartDTO): Promise<void> {
		const workspacePath = join(this.appConfig.workspaces, repo.name);

		const assignedPort = await portfinder.getPortPromise();

		this.logger.log(`[${repo.name}] Allocating port ${assignedPort} in workspace ${workspacePath}`);

		try {
			await fs.mkdir(workspacePath, { recursive: true });

			const cloneArgs = ['clone', ...(repo.branch ? ['-b', repo.branch] : []), repo.url, '.'];
			await this.executeCommand('git', cloneArgs, workspacePath, this.TIMEOUT_MS);

			await this.executeCommand('npm', ['install'], workspacePath, this.TIMEOUT_MS);

			const child = spawn(
				'opencode',
				['serve', '--port', String(assignedPort), '--hostname', this.appConfig.host],
				{
					cwd: workspacePath,
					env: {
						...process.env,
						OPENCODE_SERVER_PASSWORD: this.opencodeConfig.password,
						OPENCODE_SERVER_USERNAME: this.opencodeConfig.username,
						PORT: String(assignedPort),
					},
				}
			);

			child.stdout?.on(
				'data',
				(data) =>
					// oxlint-disable-next-line capitalized-comments
					/* v8 ignore start -- @preserve */
					this.logger.log(`[${repo.name}]: ${data.toString().trim()}`)
				// oxlint-disable-next-line capitalized-comments
				/* v8 ignore stop -- @preserve */
			);
			child.stderr?.on(
				'data',
				(data) =>
					// oxlint-disable-next-line capitalized-comments
					/* v8 ignore start -- @preserve */
					this.logger.error(`[${repo.name}-Err]: ${data.toString().trim()}`)
				// oxlint-disable-next-line capitalized-comments
				/* v8 ignore stop -- @preserve */
			);
			child.on('close', (code) => {
				this.logger.warn(`[${repo.name}] Process dropped offline unexpectedly with code ${code}`);
				this.instances.delete(repo.name);
			});

			await this.waitForHealthCheck(this.appConfig.host, assignedPort);

			this.instances.set(repo.name, { port: assignedPort, process: child, workspacePath });
			this.logger.log(`[${repo.name}] Ready on port ${assignedPort}`);
		} catch (error) {
			const instance = this.instances.get(repo.name);

			// oxlint-disable-next-line capitalized-comments
			/* v8 ignore start -- unreachable: instance is only set at L108 (last statement in try) */
			if (instance) {
				instance.process.kill();
				this.instances.delete(repo.name);
			}
			// oxlint-disable-next-line capitalized-comments
			/* v8 ignore stop */

			this.logger.error(`[${repo.name}] Failed to bootstrap: ${(error as Error).message}`);
			throw error;
		}
	}

	private executeCommand(
		command: string,
		args: string[],
		cwd: string,
		timeoutMs?: number
	): Promise<void> {
		// oxlint-disable-next-line promise/avoid-new
		return new Promise<void>((resolve, reject) => {
			const child = spawn(command, args, { cwd, shell: true });

			let timer: ReturnType<typeof setTimeout> | undefined = undefined;
			if (timeoutMs)
				timer = setTimeout(() => {
					child.kill();
					reject(new Error(`${command} timed out after ${timeoutMs}ms`));
				}, timeoutMs);

			child.on('close', (code) => {
				if (timer) clearTimeout(timer);
				if (code === 0) resolve();
				else reject(new Error(`${command} failed with exit code ${code}`));
			});
			child.on('error', (err) => {
				if (timer) clearTimeout(timer);
				reject(err);
			});
		});
	}

	private async waitForHealthCheck(
		host: string,
		port: number,
		timeoutMs = this.HEALTHCHECK_TIMEOUT_MS
	): Promise<void> {
		const start = Date.now();
		const url = `http://${host}:${port}/global/health`;

		while (Date.now() - start < timeoutMs) {
			try {
				const response = await firstValueFrom(this.httpService.get<{ healthy: boolean }>(url));
				if (response.data.healthy) return;
			} catch {
				// Server not ready yet
			}
			// oxlint-disable-next-line promise/avoid-new no-await-in-loop no-magic-numbers
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		throw new Error(`Health check timed out for ${url} after ${timeoutMs}ms`);
	}

	async stopRepository(name: string): Promise<boolean> {
		const instance = this.instances.get(name);
		if (!instance) return false;

		instance.process.kill('SIGTERM');
		this.instances.delete(name);
		this.logger.log(`[${name}] Stopped`);
		return true;
	}

	listInstances(): { name: string; port: number; workspacePath: string }[] {
		return [...this.instances.entries()].map(([name, instance]) => ({
			name,
			port: instance.port,
			workspacePath: instance.workspacePath,
		}));
	}
}
