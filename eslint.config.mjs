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
    // Audit reproduction scripts are plain Node ESM (not part of the build), so they need the
    // Node globals rather than the browser ones ESLint assumes by default.
    files: ['artifacts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
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
);
