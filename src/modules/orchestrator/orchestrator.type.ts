import type { ChildProcess } from 'node:child_process';

interface ActiveInstance {
	port: number;
	process: ChildProcess;
	workspacePath: string;
}

export type { ActiveInstance };
