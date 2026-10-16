import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.cache/**',
      '.strapi/**',
      '.tmp/**',
      'build/**',
      'dist/**',
      'src/plugins/*/dist/**',
      'node_modules/**',
      'public/**',
      'src/extensions/documentation/**',
      'types/generated/**',
      'scripts/**/*.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Playwright suite: it reads untyped JSON bodies from the API under test, so `any` is the honest type there,
    // and fixtures must destructure their first argument (`async ({}, use)`) for Playwright to parse them.
    files: ['e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-empty-pattern': 'off' },
  },
);
