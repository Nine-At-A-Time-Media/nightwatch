// Test project `console-components`: the presentational components
// (app/components) mounted in happy-dom with @vue/test-utils. They take
// props and emit events and use no Nuxt auto-import, so no Nuxt runtime is
// needed (the testing-nuxt skill: no defineVitestConfig).
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '#nightwatch': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: {
    name: 'console-components',
    root: import.meta.dirname,
    include: ['tests/components/**/*.component.test.ts'],
    environment: 'happy-dom',
    globals: false,
    sequence: { shuffle: true },
    testTimeout: 1000,
  },
});
