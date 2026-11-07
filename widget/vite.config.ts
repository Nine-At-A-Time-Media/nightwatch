// Build: one ES module bundle (Vue included) that registers <nightwatch-report>
// when a product page imports it. Single-file components ending in .ce.vue
// carry their styles into the element's shadow root.
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: 'nightwatch-report' },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
