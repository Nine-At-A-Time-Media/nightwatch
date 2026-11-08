// Lint config: typescript-eslint strict rules over source and tests.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '.agents/**',
      '.codex/**',
      'node_modules/**',
      '.wrangler/**',
      '.state/**',
      'reports/**',
      'widget/dist/**',
      'console/.nuxt/**',
      'console/.output/**',
      'console/.data/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: ['*/adapters/*', '*/workers/*'] }],
    },
    files: ['src/domain/**/*.ts', 'src/ports/**/*.ts', 'src/application/**/*.ts'],
  },
);
