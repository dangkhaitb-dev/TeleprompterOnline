// vitest.config.js — standalone test config, deliberately separate from
// vite.config.js (the app build config scans 11ty HTML output and runs
// purgecss/critical plugins that break under vitest).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/script/**/*.test.js'],
  },
});
