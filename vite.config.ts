import { defineConfig } from 'vitest/config';

// Note: base path matches the GitHub Pages project URL.
// For local dev the Vite dev server ignores `base`, so `/RapidPlanning/`
// does not affect `npm run dev`.
export default defineConfig({
  base: '/RapidPlanning/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    target: 'es2020',
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.types.ts'],
    },
  },
});
