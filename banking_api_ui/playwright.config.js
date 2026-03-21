// @ts-check
/**
 * Playwright E2E Test Configuration
 *
 * Prerequisites:
 *   npm install   (installs @playwright/test)
 *   npx playwright install chromium   (downloads browser binary)
 *
 * Run tests:
 *   npm run test:e2e              # headless, expects UI on :3000
 *   npm run test:e2e:ui           # interactive UI mode
 *   npm run test:e2e:api          # API-only tests (no browser/UI needed)
 *
 * Port layouts:
 *   Standard (start.sh)  → UI :3000, API :3001
 *   run-bank.sh          → UI :4000, API :3002
 *
 * The UI port is controlled by BANKING_UI_PORT (default 3000).
 * The API port is controlled by BANKING_API_BASE env var inside each spec.
 */

const { defineConfig, devices } = require('@playwright/test');

const UI_PORT = process.env.BANKING_UI_PORT || '3000';
const UI_BASE = `http://localhost:${UI_PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',

  // Fail fast on CI; allow retries locally
  retries: process.env.CI ? 2 : 0,

  // Run tests in parallel (safe since all API calls are mocked via page.route)
  workers: process.env.CI ? 1 : 2,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: UI_BASE,

    // Capture screenshots and traces on failure for debugging
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',

    // API requests that hit the backend directly
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the React dev-server if it's not already running on the expected port.
  // reuseExistingServer: true means if something is already listening on that
  // port (including another CRA instance or run-bank.sh), Playwright reuses it.
  webServer: {
    command: 'npm start',
    url: UI_BASE,
    reuseExistingServer: true,  // never try to restart if already running
    timeout: 120_000,           // CRA cold-start can take ~60 s
  },
});
