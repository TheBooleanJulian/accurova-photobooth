import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['apps/**/src/**/*.test.{ts,tsx}', 'packages/**/src/**/*.test.ts'],
  },
});
