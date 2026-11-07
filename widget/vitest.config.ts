// Test project `widget`: the report form's domain, fetch adapter and Vue
// component, in happy-dom with fakes. The root vitest.config.ts lists this
// file as a project, so `pnpm test` at the root runs it too.
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    name: 'widget',
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    environment: 'happy-dom',
    globals: false,
    sequence: { shuffle: true },
    testTimeout: 1000,
  },
});
