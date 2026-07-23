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
		coverage: {
			exclude: [
				'src/main.ts',
				'**/*.enum.ts',
				'**/*.interface.ts',
				'**/index.ts',
				'**/*.module.ts',
				'**/*.provider.ts',
				'**/*.type.ts',
				'**/*.constant.ts',
				'**/*.dto.ts',
			],
			include: ['src/**/*.ts'],
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			reportsDirectory: './coverage',
			thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
		},
		environment: 'node',
		globals: true,
		include: ['src/**/*.spec.ts'],
		root: './',
	},
});
