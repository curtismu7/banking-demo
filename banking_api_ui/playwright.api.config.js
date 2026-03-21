// @ts-check
/**
 * playwright.api.config.js — API-only test configuration.
 *
 * Runs tests that use only the `request` fixture (no browser page needed).
 * Does NOT start a web server — the banking_api_server must already be running.
 *
 * Usage:
 *   npm run test:e2e:api
 *   # or
 *   npx playwright test --config=playwright.api.config.js
 *
 * Env vars:
 *   BANKING_API_BASE  — override API host:port (default http://localhost:3001)
 *                       Set to http://localhost:3002 when using run-bank.sh
 */

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: ['banking-operations.spec.js', 'health.spec.js'],

  retries: process.env.CI ? 2 : 0,
  workers: 2,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-api', open: 'never' }],
  ],

  use: {
    // No baseURL needed — tests use API_BASE directly
    extraHTTPHeaders: { Accept: 'application/json' },
  },

  projects: [
    { name: 'api' },
  ],

  // No webServer — tests hit the API directly
});
