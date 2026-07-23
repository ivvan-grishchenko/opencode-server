import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		swc.vite({
			jsc: {
				keepClassNames: true,
				parser: {
					decorators: true,
					dynamicImport: true,
					syntax: 'typescript',
				},
				target: 'esnext',
				transform: {
					decoratorMetadata: true,
					legacyDecorator: true,
				},
			},
			module: {
				type: 'es6',
			},
		}),
	],
	resolve: { tsconfigPaths: true },
	test: {
		environment: 'node',
		fileParallelism: false,
		globals: true,
		hookTimeout: 20_000,
		include: ['test/**/*.e2e-spec.ts'],
		root: './',
		testTimeout: 30_000,
	},
});
