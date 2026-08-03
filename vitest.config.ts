import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['config/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: false,
  },
});
