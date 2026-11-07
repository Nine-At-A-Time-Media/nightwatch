// Test projects: `unit` runs domain and application code in Node with fakes;
// `integration` runs Workers code inside workerd through the Cloudflare plugin.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    sequence: { shuffle: true },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          testTimeout: 1000,
        },
      },
    ],
  },
});
