import type { Mocked } from '@suites/unit';

import { NotFoundException } from '@nestjs/common';
import { TestBed } from '@suites/unit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';

describe('orchestratorController', () => {
	let controller: OrchestratorController;
	let orchestrator: Mocked<OrchestratorService>;

	beforeEach(async () => {
		const { unit, unitRef } = await TestBed.solitary(OrchestratorController).compile();

		controller = unit;
		orchestrator = unitRef.get(OrchestratorService);
	});

	afterEach(() => vi.resetAllMocks());

	describe('startRepository', () => {
		const repo = { name: 'my-project', url: 'https://github.com/user/repo' };

		it('should return existing port if repository is already running', async () => {
			orchestrator.getPort.mockReturnValue(3_000);

			const result = await controller.startRepository(repo);

			expect(result).toStrictEqual({
				message: 'Repository my-project is already running on port 3000',
				port: 3_000,
			});
			expect(orchestrator.startRepository).not.toHaveBeenCalled();
		});

		it('should start repository and return assigned port when not running', async () => {
			orchestrator.getPort.mockReturnValueOnce(undefined).mockReturnValueOnce(4_000);
			await orchestrator.startRepository.mockResolvedValue(undefined);

			const result = await controller.startRepository(repo);

			expect(orchestrator.startRepository).toHaveBeenCalledWith(repo);
			expect(result).toStrictEqual({
				message: 'Repository my-project started successfully on port 4000',
				port: 4_000,
			});
		});

		it('should throw NotFoundException if startRepository fails to assign a port', async () => {
			orchestrator.getPort.mockReturnValue(undefined);
			await orchestrator.startRepository.mockResolvedValue(undefined);

			await expect(controller.startRepository(repo)).rejects.toThrow(NotFoundException);
		});

		it('should pass branch to orchestrator when provided', async () => {
			const repoWithBranch = { ...repo, branch: 'develop' };
			orchestrator.getPort.mockReturnValueOnce(undefined).mockReturnValueOnce(5_000);
			await orchestrator.startRepository.mockResolvedValue(undefined);

			await controller.startRepository(repoWithBranch);

			expect(orchestrator.startRepository).toHaveBeenCalledWith(repoWithBranch);
		});
	});

	describe('listInstances', () => {
		it('should return the list of instances from orchestrator', async () => {
			const instances = [
				{ name: 'repo-a', port: 3_001, workspacePath: '/ws/a' },
				{ name: 'repo-b', port: 3_002, workspacePath: '/ws/b' },
			];
			orchestrator.listInstances.mockReturnValue(instances);

			const result = await controller.listInstances();

			expect(result).toStrictEqual(instances);
			expect(orchestrator.listInstances).toHaveBeenCalledTimes(1);
		});

		it('should return empty array when no instances are running', async () => {
			orchestrator.listInstances.mockReturnValue([]);

			const result = await controller.listInstances();

			expect(result).toStrictEqual([]);
		});
	});

	describe('stopRepository', () => {
		it('should stop the repository successfully', async () => {
			await orchestrator.stopRepository.mockResolvedValue(true);

			await expect(controller.stopRepository('my-project')).resolves.toBeUndefined();
			expect(orchestrator.stopRepository).toHaveBeenCalledWith('my-project');
		});

		it('should throw NotFoundException when repository is not running', async () => {
			await orchestrator.stopRepository.mockResolvedValue(false);

			await expect(controller.stopRepository('my-project')).rejects.toThrow(NotFoundException);
		});
	});

	describe('getRepositoryStatus', () => {
		it('should return running status with port when instance exists', async () => {
			orchestrator.getPort.mockReturnValue(3_000);

			const result = await controller.getRepositoryStatus('my-project');

			expect(result).toStrictEqual({
				isRunning: true,
				name: 'my-project',
				port: 3_000,
			});
		});

		it('should return not running status when instance does not exist', async () => {
			orchestrator.getPort.mockReturnValue(undefined);

			const result = await controller.getRepositoryStatus('my-project');

			expect(result).toStrictEqual({
				isRunning: false,
				name: 'my-project',
				port: undefined,
			});
		});
	});
});
