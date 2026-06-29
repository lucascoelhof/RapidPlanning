import { defineConfig } from '@playwright/test';

/**
 * E2E tests run against `vite preview` (local), not the live GitHub Pages
 * deployment. This makes them deterministic, offline-capable, and fast.
 *
 * For multi-browser P2P tests, each test launches multiple `context`s in the
 * same browser process — different contexts can establish WebRTC connections
 * to each other through the local PeerJS cloud (or a locally-hosted PeerServer
 * via the `PEER_SERVER_HOST` env var).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
