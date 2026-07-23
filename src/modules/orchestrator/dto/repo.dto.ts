import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RepositoryStartSchema = z.object({
	branch: z.string().optional(),
	name: z.string(),
	url: z.url(),
});
const RepositoryStartResponseSchema = z.object({
	message: z.string(),
	port: z.number().int(),
});
const RepositoryStatusSchema = z.object({
	isRunning: z.boolean(),
	name: z.string(),
	port: z.number().int().optional(),
});

const InstanceSchema = z.object({
	name: z.string(),
	port: z.number().int(),
	workspacePath: z.string(),
});

class RepositoryStartDTO extends createZodDto(RepositoryStartSchema) {}
class RepositoryStartResponseDTO extends createZodDto(RepositoryStartResponseSchema) {}
class RepositoryStatusDTO extends createZodDto(RepositoryStatusSchema) {}
class ListInstanceDTO extends createZodDto(InstanceSchema) {}

export { RepositoryStartDTO, RepositoryStartResponseDTO, RepositoryStatusDTO, ListInstanceDTO };
