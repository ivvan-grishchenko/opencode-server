import {
	Body,
	Controller,
	Delete,
	Get,
	HttpStatus,
	NotFoundException,
	Param,
	Post,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiBody,
	ApiNotFoundResponse,
	ApiOperation,
	ApiParam,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import {
	ListInstanceDTO,
	RepositoryStartDTO,
	RepositoryStartResponseDTO,
	RepositoryStatusDTO,
} from './dto/repo.dto';
// oxlint-disable-next-line typescript/consistent-type-imports
import { OrchestratorService } from './orchestrator.service';

@ApiTags('orchestrator')
@ApiBearerAuth('access-token')
@Controller('orchestrator')
export class OrchestratorController {
	constructor(private readonly orchestrator: OrchestratorService) {}

	@Post('start')
	@ApiOperation({
		description:
			'Clones the repository (optionally checking out a branch), runs `npm install`, and starts an opencode server instance on an available port. Returns the assigned port if the repository is already running.',
		summary: 'Start a repository',
	})
	@ApiBody({ description: 'Repository URL and optional branch to start', type: RepositoryStartDTO })
	@ApiResponse({ description: 'Repository failed to start', status: 404 })
	@ZodResponse({ status: HttpStatus.CREATED, type: RepositoryStartResponseDTO })
	async startRepository(@Body() repo: RepositoryStartDTO): Promise<RepositoryStartResponseDTO> {
		const existingPort = this.orchestrator.getPort(repo.name);

		if (existingPort)
			return {
				message: `Repository ${repo.name} is already running on port ${existingPort}`,
				port: existingPort,
			};

		await this.orchestrator.startRepository(repo);

		const port = this.orchestrator.getPort(repo.name);
		if (!port) throw new NotFoundException(`Repository ${repo.name} failed to start or not found`);

		return {
			message: `Repository ${repo.name} started successfully on port ${port}`,
			port,
		};
	}

	@Get('instances')
	@ApiOperation({
		description:
			'Returns all currently active repository instances with their name, port, and workspace path.',
		summary: 'List running instances',
	})
	@ZodResponse({
		description: 'List of running instances',
		status: HttpStatus.OK,
		type: [ListInstanceDTO],
	})
	async listInstances(): Promise<ListInstanceDTO[]> {
		return this.orchestrator.listInstances();
	}

	@Delete('stop/:name')
	@ApiOperation({
		description:
			'Stops the opencode server process for the given repository name and removes it from the active instances map.',
		summary: 'Stop a repository',
	})
	@ApiParam({
		description: 'Repository name (used as the workspace directory name)',
		example: 'my-project',
		name: 'name',
	})
	@ApiResponse({ description: 'Repository stopped successfully', status: HttpStatus.NO_CONTENT })
	@ApiNotFoundResponse({ description: 'Repository is not running' })
	async stopRepository(@Param('name') name: string): Promise<void> {
		const stopped = await this.orchestrator.stopRepository(name);

		if (!stopped) throw new NotFoundException(`Repository ${name} is not running`);
	}

	@Get('repository/:name')
	@ApiOperation({
		description:
			'Checks whether a repository instance is currently running and returns its name, running state, and port if active.',
		summary: 'Get repository status',
	})
	@ApiParam({ description: 'Repository name to check', example: 'my-project', name: 'name' })
	@ZodResponse({ description: 'Repository status', status: 200, type: RepositoryStatusDTO })
	async getRepositoryStatus(@Param('name') name: string): Promise<RepositoryStatusDTO> {
		const port = this.orchestrator.getPort(name);

		return {
			isRunning: Boolean(port),
			name,
			port,
		};
	}
}
