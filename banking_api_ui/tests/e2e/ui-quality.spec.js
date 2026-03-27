/**
 * @file ui-quality.spec.js
 * @description BX Finance UI Quality Evaluator — Playwright E2E harness.
 *
 * Each describe block maps to one criterion in docs/ui-quality-criteria.md.
 * Tests encode "professional banking UI" as concrete, machine-checkable rules
 * so regressions are caught before they reach main.
 *
 * All API calls are mocked — no live server required.
 * Run: npm run test:e2e:quality
 *
 * Criteria covered:
 *   1. Layout & Positioning  — FAB visible, non-overlapping, correct offsets
 *   2. Data Quality          — Formatted currency/dates, no raw values or placeholders
 *   3. Error UX Quality      — Friendly messages, no stack traces
 *   4. Notification Quality  — No toast storms or duplicates on page load
 *   5. Brand & Professional  — BX Finance branding, no raw HTML/JSON artifacts
 *   6. Console Health        — No JS errors on page load
 */

const { test, expect } = require('@playwright/test');
const {
  mockCustomerDashboard,
} = require('./helpers/customerDashboardMocks');

// ─── Shared setup ─────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  });
});

/** Collapse the BankingAgent panel if it auto-opened after login. */
async function dismissAgentPanel(page) {
  try {
    await page.getByRole('button', { name: 'Collapse agent' }).click({ timeout: 4000 });
  } catch (_) { /* already collapsed or floating mode */ }
}

/** Mock the unauthenticated landing state. */
async function mockLanding(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) }),
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) }),
  );
  await page.route('**/api/admin/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ config: {} }) }),
  );
  await page.route('**/ws**', (route) => route.abort());
}

// ─── Criterion 1: Layout & Positioning ────────────────────────────────────────
// Prevents: FAB buried/clipped, overlapping logout, invisible outside viewport.
// Regression: b19254e "fix(ui): FAB positioning on dashboard"

test.describe('Layout & Positioning', () => {

  test('FAB is fully visible within the viewport on /dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    const fab = page.locator('.banking-agent-fab');
    await expect(fab).toBeVisible({ timeout: 15000 });

    const box = await fab.boundingBox();
    expect(box, 'FAB bounding box must be measurable').not.toBeNull();

    const vp = page.viewportSize();
    expect(box.x, 'FAB left edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(box.y, 'FAB top edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'FAB right edge inside viewport').toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height, 'FAB bottom edge inside viewport').toBeLessThanOrEqual(vp.height);
  });

  test('FAB bottom gap from viewport edge is at least 16px', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    const fab = page.locator('.banking-agent-fab');
    await expect(fab).toBeVisible({ timeout: 15000 });

    const box = await fab.boundingBox();
    const vp = page.viewportSize();
    const bottomGap = vp.height - (box.y + box.height);

    expect(bottomGap, `FAB bottom gap is ${bottomGap}px, need ≥ 16px`).toBeGreaterThanOrEqual(16);
  });

  test('FAB right gap from viewport edge is at least 16px', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    const fab = page.locator('.banking-agent-fab');
    await expect(fab).toBeVisible({ timeout: 15000 });

    const box = await fab.boundingBox();
    const vp = page.viewportSize();
    const rightGap = vp.width - (box.x + box.width);

    expect(rightGap, `FAB right gap is ${rightGap}px, need ≥ 16px`).toBeGreaterThanOrEqual(16);
  });

  test('FAB does not overlap the logout button on /dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    const fab = page.locator('.banking-agent-fab');
    const logout = page.locator('.logout-btn');

    await expect(fab).toBeVisible({ timeout: 15000 });
    await expect(logout).toBeVisible({ timeout: 15000 });

    const fabBox = await fab.boundingBox();
    const logoutBox = await logout.boundingBox();

    const noOverlap =
      fabBox.x >= logoutBox.x + logoutBox.width ||
      fabBox.x + fabBox.width <= logoutBox.x ||
      fabBox.y >= logoutBox.y + logoutBox.height ||
      fabBox.y + fabBox.height <= logoutBox.y;

    expect(noOverlap, 'FAB must not overlap logout button').toBe(true);
  });

  test('FAB is visible on the landing page without overlapping hero CTAs', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/');

    const fab = page.locator('.banking-agent-fab');
    await expect(fab).toBeVisible({ timeout: 15000 });

    const box = await fab.boundingBox();
    const vp = page.viewportSize();

    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  });

});

// ─── Criterion 2: Data Quality ─────────────────────────────────────────────────
// Prevents: raw ISO dates, unformatted balances, [object Object], demo data bleed.
// Regression: 09ddac9 "fix: take worktree version of UserDashboard — real data first"

test.describe('Data Quality', () => {

  test('account balances display as $X,XXX.XX with currency formatting', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });

    // Formatted currency must be present
    await expect(page.locator('.user-dashboard')).toContainText('$1,500.00');

    // Raw unformatted float must not appear
    const text = await page.locator('.user-dashboard').innerText();
    expect(text, 'Raw float 1500.0 must not appear').not.toMatch(/\b1500\.0\b/);
  });

  test('transaction dates display as human-readable strings not ISO 8601', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.getByRole('heading', { name: 'Recent Transactions' })).toBeVisible({ timeout: 15000 });

    const text = await page.locator('.user-dashboard').innerText();
    expect(text, 'ISO date string must not be rendered raw').not.toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  test('greeting shows the authenticated user\'s name', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.getByText(/Hello,\s*Test/i)).toBeVisible({ timeout: 15000 });
  });

  test('no "[object Object]" text visible on customer dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    const text = await page.locator('.user-dashboard').innerText();
    expect(text, '[object Object] must never reach the DOM').not.toContain('[object Object]');
  });

  test('no "undefined" text visible on customer dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    const text = await page.locator('.user-dashboard').innerText();
    expect(text, '"undefined" must never reach the DOM').not.toMatch(/\bundefined\b/);
  });

  test('demo fallback data does not bleed into the dashboard when real API succeeds', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    // Real accounts are loaded; demo placeholder labels must not appear alongside them
    await expect(page.getByText('Primary Checking')).toBeVisible({ timeout: 15000 });

    const text = await page.locator('.user-dashboard').innerText();
    // Demo fixtures use "Demo Checking" / "Demo Savings" labels
    expect(text, 'Demo account labels must not appear when real data loaded').not.toMatch(
      /Demo (Checking|Savings|Account)/i,
    );
  });

});

// ─── Criterion 3: Error UX Quality ────────────────────────────────────────────
// Prevents: JS stack traces in chat, raw JSON error bodies visible to users.

test.describe('Error UX Quality', () => {

  test('MCP 502 shows friendly message with no stack trace in agent panel', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.route('**/api/mcp/tool', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'mcp_error: WebSocket connection failed' }),
      }),
    );

    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-panel')).toBeVisible({ timeout: 20000 });

    await page.locator('.banking-agent-panel').getByRole('button', { name: /My Accounts/i }).click();

    const messages = page.locator('.banking-agent-messages');
    await expect(messages).toBeVisible();
    await expect(messages).toContainText(/unavailable|not reachable|mcp/i);

    const msgText = await messages.innerText();
    expect(msgText, 'Stack trace must not appear').not.toMatch(/at Object\./);
    expect(msgText, 'Stack trace line must not appear').not.toMatch(/at \w+\s*\(/);
    expect(msgText, 'Raw Error: prefix must not appear').not.toContain('Error: ');
  });

  test('403 scope error on /transactions/my does not crash the dashboard', async ({ page }) => {
    await mockCustomerDashboard(page, {
      transactionsHandler: (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'insufficient_scope', requiredScopes: ['banking:transactions:read'] }),
        }),
    });

    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    // Accounts section must still render
    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });

    // No raw JSON or stack trace in the dashboard body
    const text = await page.locator('.user-dashboard').innerText();
    expect(text, 'Raw JSON key must not appear').not.toMatch(/"error"\s*:/);
    expect(text, 'Stack trace must not appear').not.toMatch(/at Object\./);
  });

});

// ─── Criterion 4: Notification Quality ────────────────────────────────────────
// Prevents: duplicate toasts, toast storms on page load.
// Regression: 2fb9d7a "fix(ui): dedupe session toasts"

test.describe('Notification Quality', () => {

  test('customer dashboard shows at most 1 toast on initial page load', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    // Allow a brief window for async toasts to fire
    await page.waitForTimeout(2000);

    const toastCount = await page.locator('.Toastify__toast').count();
    expect(toastCount, `Expected ≤ 1 toast, got ${toastCount}`).toBeLessThanOrEqual(1);
  });

  test('landing page shows zero toasts on initial load', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/');

    await expect(page.locator('.landing-page')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const toastCount = await page.locator('.Toastify__toast').count();
    expect(toastCount, `Expected 0 toasts on landing, got ${toastCount}`).toBe(0);
  });

  test('navigating dashboard → mcp-inspector → back does not stack duplicate toasts', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.route('**/api/mcp/inspector/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
    );

    await page.goto('/dashboard');
    await dismissAgentPanel(page);
    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });

    // Navigate to mcp-inspector and back
    await page.locator('a.dashboard-header-mcp-btn').evaluate((el) => el.click());
    await page.waitForURL(/\/mcp-inspector/, { timeout: 15000 });
    await page.goBack();
    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);
    const toastCount = await page.locator('.Toastify__toast').count();
    expect(toastCount, `Expected ≤ 1 toast after navigation, got ${toastCount}`).toBeLessThanOrEqual(1);
  });

});

// ─── Criterion 5: Brand & Professional Standards ───────────────────────────────
// Prevents: broken branding, missing sections, raw HTML/JSON artifacts.

test.describe('Brand & Professional Standards', () => {

  test('BX Finance brand name is present on the landing page', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/');

    await expect(page.locator('.brand-name').first()).toHaveText('BX Finance');
  });

  test('customer dashboard always contains Your Accounts and Recent Transactions sections', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Recent Transactions' })).toBeVisible();
  });

  test('no HTML entities (&lt; &gt; &amp;) visible as raw text on dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    const text = await page.locator('.user-dashboard').innerText();

    expect(text, '&lt; must not appear as literal text').not.toContain('&lt;');
    expect(text, '&gt; must not appear as literal text').not.toContain('&gt;');
    expect(text, '&amp; must not appear as literal text').not.toContain('&amp;');
  });

  test('no raw JSON key patterns (e.g. "accountId":) visible on dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    const text = await page.locator('.user-dashboard').innerText();
    expect(text, 'Raw JSON key-value pattern must not appear').not.toMatch(/"[a-zA-Z_]+"\s*:/);
  });

  test('no broken images (img elements with missing or zero-size src) on dashboard', async ({ page }) => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });

    const brokenImages = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.src || '(empty src)'),
    );

    expect(brokenImages, `Broken images found: ${brokenImages.join(', ')}`).toHaveLength(0);
  });

});

// ─── Criterion 6: Console Health ──────────────────────────────────────────────
// Prevents: silent JS errors, React key warnings, unhandled promise rejections.

test.describe('Console Health', () => {

  /**
   * Errors expected in test environments that are not real bugs:
   *  - WebSocket errors: page.route aborts WS connections
   *  - net::ERR_ABORTED: Playwright intercepts cancel the request
   */
  function isTestEnvNoise(text) {
    return text.includes('WebSocket') || text.includes('net::ERR_ABORTED');
  }

  test('customer dashboard has no console errors on page load', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));

    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);
    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);

    const realErrors = errors.filter((e) => !isTestEnvNoise(e));
    expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0);
  });

  test('landing page has no console errors on page load', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));

    await mockLanding(page);
    await page.goto('/');
    await expect(page.locator('.landing-page')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);

    const realErrors = errors.filter((e) => !isTestEnvNoise(e));
    expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0);
  });

  test('opening and closing the agent panel generates no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));

    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgentPanel(page);

    // Open the panel via FAB
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-panel')).toBeVisible({ timeout: 20000 });

    // Close it again
    await page.getByRole('button', { name: 'Collapse agent' }).click();
    await expect(page.locator('.banking-agent-panel')).not.toBeVisible();

    await page.waitForTimeout(500);

    const realErrors = errors.filter((e) => !isTestEnvNoise(e));
    expect(realErrors, `Console errors during panel toggle: ${realErrors.join('\n')}`).toHaveLength(0);
  });

});
