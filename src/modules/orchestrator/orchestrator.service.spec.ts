import type { ConfigType } from '@nestjs/config';
import type { Mocked } from '@suites/unit';
import type { ChildProcess } from 'node:child_process';

import { AppConfig } from '@config/app.config';
import { OpencodeConfig } from '@config/opencode.config';
import { HttpService } from '@nestjs/axios';
import { TestBed } from '@suites/unit';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrchestratorService } from './orchestrator.service';

vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
	promises: {
		mkdir: vi.fn(),
	},
}));

vi.mock('portfinder', () => ({
	default: {
		basePort: 3_000,
		getPortPromise: vi.fn(),
	},
}));

describe('orchestratorService', () => {
	const appConfig: ConfigType<typeof AppConfig> = {
		healthProbeTimeoutMs: 1_000,
		host: '127.0.0.1',
		port: 3_000,
		proxyBasePath: 'services',
		workspaces: '/workspaces',
	};

	const opencodeConfig: ConfigType<typeof OpencodeConfig> = {
		apiKey: 'test-api-key',
		password: 'test-password',
		username: 'test-user',
	};

	let service: OrchestratorService;
	let httpService: Mocked<HttpService>;
	let spawn: ReturnType<typeof vi.fn>;
	let mkdir: ReturnType<typeof vi.fn>;
	let getPortPromise: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(OrchestratorService)
			.mock(AppConfig.KEY)
			.final(appConfig)
			.mock(OpencodeConfig.KEY)
			.final(opencodeConfig)
			.compile();

		service = unit;
		httpService = unitRef.get(HttpService);

		const childProcessModule = await import('node:child_process');
		spawn = vi.mocked(childProcessModule.spawn);
		const fsModule = await import('node:fs');
		mkdir = vi.mocked(fsModule.promises.mkdir);
		const portfinderModule = await import('portfinder');
		getPortPromise = vi.mocked(portfinderModule.default.getPortPromise);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.resetAllMocks();
	});

	type MockProcess = ChildProcess & {
		close(code: number): void;
	};

	function createMockProcess(): MockProcess {
		const proc = new EventEmitter() as unknown as MockProcess;
		// @ts-expect-error minimal mock for testing
		proc.stdout = new EventEmitter();
		// @ts-expect-error minimal mock for testing
		proc.stderr = new EventEmitter();
		// oxlint-disable-next-line vitest/prefer-spy-on
		proc.kill = vi.fn();
		proc.close = (code: number) => (proc as EventEmitter).emit('close', code);
		return proc;
	}

	function setupHealthyHealthCheck(): void {
		httpService.get.mockReturnValue(of({ data: { healthy: true } }) as any);
	}

	function setupSuccessfulSpawn(): MockProcess {
		const opencodeProcess = createMockProcess();
		spawn
			.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
				const gitProc = createMockProcess();
				process.nextTick(() => gitProc.close(0));
				return gitProc;
			})
			.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
				const npmProc = createMockProcess();
				process.nextTick(() => npmProc.close(0));
				return npmProc;
			})
			.mockReturnValueOnce(opencodeProcess);
		return opencodeProcess;
	}

	describe('getPort', () => {
		it('should return undefined for unknown instance', () => {
			expect(service.getPort('unknown')).toBeUndefined();
		});
	});

	describe('startRepository', () => {
		const repo = {
			name: 'test-repo',
			url: 'https://github.com/user/repo.git',
		};

		beforeEach(() => {
			getPortPromise.mockResolvedValue(4_000);
			mkdir.mockResolvedValue(undefined);
		});

		it('should skip bootstrap when repository is already running', async () => {
			setupSuccessfulSpawn();
			setupHealthyHealthCheck();

			await service.startRepository(repo);

			const callsBefore = spawn.mock.calls.length;
			await service.startRepository(repo);

			expect(spawn).toHaveBeenCalledTimes(callsBefore);
		});

		it('should clone repository and start opencode', async () => {
			setupSuccessfulSpawn();
			setupHealthyHealthCheck();

			await service.startRepository(repo);

			expect(mkdir).toHaveBeenCalledWith(join('/workspaces', 'test-repo'), {
				recursive: true,
			});

			const gitCall = spawn.mock.calls.find((call: any[]) => call[0] === 'git');
			expect(gitCall).toBeDefined();
			expect(gitCall![1]).toStrictEqual(['clone', 'https://github.com/user/repo.git', '.']);

			const opencodeCall = spawn.mock.calls.find((call: any[]) => call[0] === 'opencode');
			expect(opencodeCall).toBeDefined();
			expect(opencodeCall![1]).toStrictEqual([
				'serve',
				'--port',
				'4000',
				'--hostname',
				'127.0.0.1',
			]);
		});

		it('should include branch flag when branch is specified', async () => {
			const repoWithBranch = { ...repo, branch: 'develop' };
			setupSuccessfulSpawn();
			setupHealthyHealthCheck();

			await service.startRepository(repoWithBranch);

			const gitCall = spawn.mock.calls.find((call: any[]) => call[0] === 'git');
			expect(gitCall![1]).toStrictEqual([
				'clone',
				'-b',
				'develop',
				'https://github.com/user/repo.git',
				'.',
			]);
		});

		it('should set process.on close handler that removes instance', async () => {
			const opencodeProcess = setupSuccessfulSpawn();
			setupHealthyHealthCheck();

			await service.startRepository(repo);
			expect(service.getPort('test-repo')).toBe(4_000);

			opencodeProcess.close(1);
			expect(service.getPort('test-repo')).toBeUndefined();
		});

		it('should throw and clean up process on bootstrap failure', async () => {
			mkdir.mockRejectedValue(new Error('mkdir failed'));

			await expect(service.startRepository(repo)).rejects.toThrow('mkdir failed');
		});

		it('should pass opencode config env vars to spawned process', async () => {
			setupSuccessfulSpawn();
			setupHealthyHealthCheck();

			await service.startRepository(repo);

			const opencodeCall = spawn.mock.calls.find((call: any[]) => call[0] === 'opencode');
			expect(opencodeCall![2].env).toMatchObject({
				OPENCODE_SERVER_PASSWORD: 'test-password',
				OPENCODE_SERVER_USERNAME: 'test-user',
				PORT: '4000',
			});
		});
	});

	describe('waitForHealthCheck', () => {
		const repo = {
			name: 'health-repo',
			url: 'https://github.com/user/repo.git',
		};

		beforeEach(() => {
			getPortPromise.mockResolvedValue(5_000);
			mkdir.mockResolvedValue(undefined);
		});

		it('should poll until healthy response is received', async () => {
			setupSuccessfulSpawn();

			let callCount = 0;
			httpService.get.mockImplementation(() => {
				callCount++;
				if (callCount < 3) return of({ data: { healthy: false } }) as any;
				return of({ data: { healthy: true } }) as any;
			});

			await service.startRepository(repo);

			expect(httpService.get).toHaveBeenCalledTimes(3);
			expect(service.getPort('health-repo')).toBe(5_000);
		});

		it('should throw when health check times out', async () => {
			setupSuccessfulSpawn();

			vi.useFakeTimers();

			httpService.get.mockImplementation(() => {
				throw new Error('ECONNREFUSED');
			});

			let caughtError: unknown;
			// oxlint-disable-next-line promise/prefer-await-to-then promise/prefer-await-to-callbacks
			const promise = service.startRepository(repo).catch((error: unknown) => {
				caughtError = error;
			});

			await vi.advanceTimersByTimeAsync(31_000);
			await promise;

			expect(caughtError).toBeInstanceOf(Error);
			expect((caughtError as Error).message).toMatch(/Health check timed out/);
		});
	});

	describe('stopRepository', () => {
		it('should return false when instance does not exist', async () => {
			await expect(service.stopRepository('nonexistent')).resolves.toBeFalsy();
		});

		it('should kill process and remove instance', async () => {
			const repo = {
				name: 'stop-repo',
				url: 'https://github.com/user/repo.git',
			};

			const opencodeProcess = setupSuccessfulSpawn();
			getPortPromise.mockResolvedValue(6_000);
			mkdir.mockResolvedValue(undefined);
			setupHealthyHealthCheck();

			await service.startRepository(repo);
			expect(service.getPort('stop-repo')).toBe(6_000);

			const result = await service.stopRepository('stop-repo');

			expect(result).toBeTruthy();
			expect(opencodeProcess.kill).toHaveBeenCalledWith('SIGTERM');
			expect(service.getPort('stop-repo')).toBeUndefined();
		});
	});

	describe('listInstances', () => {
		it('should return empty array when no instances', () => {
			expect(service.listInstances()).toStrictEqual([]);
		});

		it('should return all running instances', async () => {
			const repo1 = {
				name: 'repo-1',
				url: 'https://github.com/user/repo1.git',
			};
			const repo2 = {
				name: 'repo-2',
				url: 'https://github.com/user/repo2.git',
			};

			getPortPromise.mockResolvedValueOnce(4_000).mockResolvedValueOnce(4_001);
			mkdir.mockResolvedValue(undefined);
			setupHealthyHealthCheck();

			spawn
				.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
					const proc = createMockProcess();
					process.nextTick(() => proc.close(0));
					return proc;
				})
				.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
					const proc = createMockProcess();
					process.nextTick(() => proc.close(0));
					return proc;
				})
				.mockReturnValueOnce(createMockProcess())
				.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
					const proc = createMockProcess();
					process.nextTick(() => proc.close(0));
					return proc;
				})
				.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
					const proc = createMockProcess();
					process.nextTick(() => proc.close(0));
					return proc;
				})
				.mockReturnValueOnce(createMockProcess());

			await service.startRepository(repo1);
			await service.startRepository(repo2);

			const instances = service.listInstances();

			expect(instances).toHaveLength(2);
			expect(instances).toContainEqual({
				name: 'repo-1',
				port: 4_000,
				workspacePath: join('/workspaces', 'repo-1'),
			});
			expect(instances).toContainEqual({
				name: 'repo-2',
				port: 4_001,
				workspacePath: join('/workspaces', 'repo-2'),
			});
		});
	});

	describe('executeCommand', () => {
		it('should timeout and kill process when command hangs', async () => {
			vi.useFakeTimers();

			const repo = {
				name: 'hang-repo',
				url: 'https://github.com/user/repo.git',
			};

			getPortPromise.mockResolvedValue(9_000);
			mkdir.mockResolvedValue(undefined);

			const hangingProcess = createMockProcess();
			spawn.mockReturnValueOnce(hangingProcess);

			const promise = service.startRepository(repo);
			// oxlint-disable-next-line vitest/valid-expect
			const assertion = expect(promise).rejects.toThrow('git timed out after');

			await vi.advanceTimersByTimeAsync(120_000);
			await assertion;

			expect(hangingProcess.kill).toHaveBeenCalledWith();
		});

		it('should reject when command exits with non-zero code', async () => {
			const repo = {
				name: 'fail-repo',
				url: 'https://github.com/user/repo.git',
			};

			getPortPromise.mockResolvedValue(7_000);
			mkdir.mockResolvedValue(undefined);

			spawn.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
				const proc = createMockProcess();
				process.nextTick(() => proc.close(1));
				return proc;
			});

			await expect(service.startRepository(repo)).rejects.toThrow('git failed with exit code 1');
		});

		it('should reject when command errors', async () => {
			const repo = {
				name: 'error-repo',
				url: 'https://github.com/user/repo.git',
			};

			getPortPromise.mockResolvedValue(8_000);
			mkdir.mockResolvedValue(undefined);

			spawn.mockImplementationOnce((_cmd: string, _args: string[], _opts: any) => {
				const proc = createMockProcess();
				process.nextTick(() => (proc as EventEmitter).emit('error', new Error('ENOENT')));
				return proc;
			});

			await expect(service.startRepository(repo)).rejects.toThrow('ENOENT');
		});

		it('should resolve when command exits 0 without a timeout', async () => {
			const proc = createMockProcess();
			spawn.mockReturnValueOnce(proc);

			const promise = (service as any).executeCommand('echo', ['hello'], '/tmp');

			process.nextTick(() => proc.close(0));
			await expect(promise).resolves.toBeUndefined();
		});

		it('should reject on error without a timeout', async () => {
			const proc = createMockProcess();
			spawn.mockReturnValueOnce(proc);

			const promise = (service as any).executeCommand('bad-cmd', [], '/tmp');

			process.nextTick(() => (proc as EventEmitter).emit('error', new Error('ENOENT')));
			await expect(promise).rejects.toThrow('ENOENT');
		});
	});
});
