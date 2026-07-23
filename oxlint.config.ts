import { defineConfig } from 'oxlint';

export default defineConfig({
	categories: {
		correctness: 'error', // Catch bugs and broken code immediately
		perf: 'error', // Performance optimization rules
		style: 'error', // Stylistic/readability warnings
	},
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
	options: {
		maxWarnings: 10,
		typeAware: true,
		typeCheck: true,
	},
	overrides: [
		{
			files: ['**/*.spec.*'],
			rules: {
				'init-declarations': 'off',
				'no-explicit-any': 'off',
				'no-magic-numbers': 'off',
				'typescript/unbound-method': 'off',
			},
		},
	],
	plugins: ['import', 'oxc', 'promise', 'vitest', 'typescript', 'unicorn', 'eslint', 'node'],
	rules: {
		'class-methods-use-this': 'off',
		curly: ['error', 'multi'],
		'func-style': ['error', 'declaration'],
		'import/consistent-type-specifier-style': 'off',
		'import/no-named-export': 'off',
		'import/no-nodejs-modules': 'off',
		'import/prefer-default-export': 'off',
		'max-params': ['error', { max: 20 }],
		'max-statements': ['error', { max: 40 }],
		'new-cap': 'off',
		'no-await-in-loop': 'off',
		'no-console': 'error',
		'no-continue': 'off',
		'no-debugger': 'error',
		'no-duplicate-imports': 'off',
		'no-duplicates': 'error',
		'no-magic-numbers': [
			'error',
			{ ignore: [0, 1], ignoreArrayIndexes: true, ignoreTypeIndexes: true },
		],
		'no-ternary': 'off',
		'sort-imports': [
			'error',
			{
				ignoreDeclarationSort: true,
				ignoreMemberSort: false,
			},
		],
		'typescript/consistent-type-imports': [
			'error',
			{ disallowTypeAnnotations: false, fixStyle: 'separate-type-imports' },
		],
		'typescript/method-signature-style': ['error', 'method'],
		'typescript/no-explicit-any': 'error',
		'typescript/parameter-properties': ['error', { prefer: 'parameter-property' }],
		'unicorn/filename-case': ['error', { case: 'kebabCase' }],
		'unicorn/no-null': 'off',
		'unicorn/numeric-separators-style': ['error', { number: { minimumDigits: 0 } }],
		'unicorn/prefer-global-this': 'off',
		'vitest/consistent-test-filename': [
			'error',
			{ allTestPattern: '__tests__', pattern: '.*.spec.ts$' },
		],
		'vitest/max-expects': 'off',
		'vitest/no-hooks': 'off',
		'vitest/no-importing-vitest-globals': 'off',
		'vitest/prefer-called-once': 'off',
		'vitest/prefer-expect-assertions': 'off',
		'vitest/prefer-import-in-mock': 'off',
		'vitest/prefer-importing-vitest-globals': 'error',
		'vitest/prefer-strict-boolean-matchers': 'off',
		'vitest/require-mock-type-parameters': 'off',
	},
});
