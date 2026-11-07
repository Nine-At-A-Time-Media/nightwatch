// Lint config: typescript-eslint strict rules over source and tests.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.wrangler/**', '.state/**', 'reports/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: ['*/adapters/*', '*/workers/*'] }],
    },
    files: ['src/domain/**/*.ts', 'src/ports/**/*.ts', 'src/application/**/*.ts'],
  },
);
