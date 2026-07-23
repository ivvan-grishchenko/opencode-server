import { defineConfig } from 'oxfmt';

export default defineConfig({
	arrowParens: 'always',
	bracketSameLine: true,
	bracketSpacing: true,
	endOfLine: 'lf',
	ignorePatterns: [
		'.idea',
		'dist',
		'node_modules',
		'coverage',
		'.git',
		'*.md',
		'*.yaml',
		'*.yml',
		'*.json',
		'*.lock,',
		'pnpm-lock.yaml',
		'*.gen.ts',
	],
	printWidth: 100,
	semi: true,
	singleQuote: true,
	sortImports: {
		groups: [
			'type-import',
			['value-builtin', 'value-external'],
			'type-internal',
			'value-internal',
			['type-parent', 'type-sibling', 'type-index'],
			['value-parent', 'value-sibling', 'value-index'],
			'unknown',
		],
	},
	sortPackageJson: {
		sortScripts: true,
	},
	tabWidth: 2,
	trailingComma: 'es5',
	useTabs: true,
});
