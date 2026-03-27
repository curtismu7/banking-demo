/**
 * @file ui-score.spec.js
 * @description BX Finance UI Scoring Evaluator — 100-point baseline.
 *
 * Produces a human-readable score report showing exactly which UI elements
 * are present vs missing. Run any time to see how far the UI has drifted.
 *
 *   npm run test:e2e:score           # from banking_api_ui/
 *   npm run test:e2e:score           # from repo root
 *
 * Output (example):
 *   🏦 BX Finance UI Score: 85/100
 *   ✅ Token Chain Display        15/15
 *   ✅ Agent FAB & Panel          20/20
 *   ❌ Dashboard Completeness      5/20  ← sections missing
 *   ✅ Landing Page               15/15
 *   ❌ Data & Error Quality        5/15  ← duplicate toasts
 *   ✅ Console & Layout Health    15/15
 *
 * A score below 70 fails the test. The per-check breakdown tells you
 * exactly what was lost so you can restore it.
 *
 * Score thresholds:
 *   100   Perfect — nothing missing
 *    85+  Healthy — minor items absent
 *    70+  Degraded — visible issues, fix before merge
 *    <70  FAILING — major UI regression, blocks CI
 *
 * All API calls mocked — no live server required.
 */

const { test, expect } = require('@playwright/test');
const { mockCustomerDashboard } = require('./helpers/customerDashboardMocks');

// ─── Scoring infrastructure ────────────────────────────────────────────────────

/**
 * Accumulates pass/fail results for one scoring session.
 * Each check is independent — a failure in one does not skip others.
 */
function makeScorecard() {
  const results = [];

  async function check(name, points, fn) {
    try {
      await fn();
      results.push({ name, points, earned: points, pass: true });
    } catch (e) {
      const reason = e.message ? e.message.split('\n')[0].slice(0, 120) : String(e);
      results.push({ name, points, earned: 0, pass: false, reason });
    }
  }

  function report() {
    const total = results.reduce((s, r) => s + r.points, 0);
    const earned = results.reduce((s, r) => s + r.earned, 0);
    const byCategory = {};
    for (const r of results) {
      const cat = r.name.split(' › ')[0];
      if (!byCategory[cat]) byCategory[cat] = { earned: 0, total: 0 };
      byCategory[cat].earned += r.earned;
      byCategory[cat].total += r.points;
    }

    const lines = [`\n${'─'.repeat(60)}`, `🏦  BX Finance UI Score: ${earned}/${total}`];
    lines.push('─'.repeat(60));
    for (const [cat, { earned: ce, total: ct }] of Object.entries(byCategory)) {
      const icon = ce === ct ? '✅' : ce === 0 ? '❌' : '⚠️ ';
      lines.push(`  ${icon}  ${cat.padEnd(35)} ${ce}/${ct}`);
    }
    lines.push('─'.repeat(60));
    const failing = results.filter((r) => !r.pass);
    if (failing.length) {
      lines.push('Missing elements:');
      for (const r of failing) {
        lines.push(`  ✗  [${r.points}pt] ${r.name}`);
        if (r.reason) lines.push(`       ${r.reason}`);
      }
    } else {
      lines.push('  All checks passed — UI is complete.');
    }
    lines.push('─'.repeat(60));
    return { earned, total, lines: lines.join('\n') };
  }

  return { check, report, results };
}

// ─── Shared mock helpers ────────────────────────────────────────────────────────

async function mockLanding(page) {
  await page.route('**/api/auth/oauth/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false, user: null }) }),
  );
  await page.route('**/api/auth/oauth/user/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false, user: null }) }),
  );
  await page.route('**/api/admin/config**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ config: {} }) }),
  );
  await page.route('**/ws**', (r) => r.abort());
}

async function dismissAgent(page) {
  try { await page.getByRole('button', { name: 'Collapse agent' }).click({ timeout: 3000 }); } catch (_) {}
}

async function openAgentPanel(page) {
  await page.locator('.banking-agent-fab').click();
  await page.locator('.banking-agent-panel').waitFor({ state: 'visible', timeout: 20000 });
}

// ─── THE SCORE TEST ────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  });
});

test('BX Finance UI Score — 100-point baseline', async ({ page }) => {
  const sc = makeScorecard();

  // ── Category 1: Token Chain Display (15 points) ────────────────────────────
  // The token tracker is one of the most frequently lost features.

  await mockCustomerDashboard(page);
  await page.goto('/dashboard');
  await dismissAgent(page);
  await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });

  await sc.check('Token Chain Display › .tcd-root component renders', 5, async () => {
    // Open the token info modal to surface the token chain component
    const tokenBtn = page.locator('.token-info-btn');
    await expect(tokenBtn).toBeVisible({ timeout: 5000 });
    await tokenBtn.click();
    await expect(page.locator('.tcd-root')).toBeVisible({ timeout: 5000 });
    // Close modal
    try { await page.locator('.close-btn').click({ timeout: 2000 }); } catch (_) {}
  });

  await sc.check('Token Chain Display › "Token Chain" title present', 5, async () => {
    const tokenBtn = page.locator('.token-info-btn');
    await expect(tokenBtn).toBeVisible({ timeout: 5000 });
    await tokenBtn.click();
    await expect(page.locator('.tcd-header-title')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tcd-header-title')).toContainText('Token Chain');
    try { await page.locator('.close-btn').click({ timeout: 2000 }); } catch (_) {}
  });

  await sc.check('Token Chain Display › "Current call" and "History" tabs present', 5, async () => {
    const tokenBtn = page.locator('.token-info-btn');
    await expect(tokenBtn).toBeVisible({ timeout: 5000 });
    await tokenBtn.click();
    await expect(page.locator('.tcd-tabs')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tcd-tab').first()).toContainText('Current call');
    await expect(page.locator('.tcd-tab').nth(1)).toContainText('History');
    try { await page.locator('.close-btn').click({ timeout: 2000 }); } catch (_) {}
  });

  // ── Category 2: Banking Agent — FAB & Panel (20 points) ───────────────────

  await sc.check('Agent FAB & Panel › FAB is visible with 🏦 icon', 5, async () => {
    const fab = page.locator('.banking-agent-fab');
    await expect(fab).toBeVisible({ timeout: 10000 });
    const fabText = await fab.innerText();
    expect(fabText).toMatch(/🏦|AI Agent/);
  });

  await sc.check('Agent FAB & Panel › Panel title "BX Finance AI Agent"', 5, async () => {
    await openAgentPanel(page);
    await expect(page.locator('.ba-title')).toHaveText('BX Finance AI Agent');
  });

  await sc.check('Agent FAB & Panel › Two-column layout (.ba-left-col + .ba-right-col)', 5, async () => {
    await expect(page.locator('.banking-agent-panel .ba-left-col')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.banking-agent-panel .ba-right-col')).toBeVisible({ timeout: 5000 });
  });

  await sc.check('Agent FAB & Panel › All 8 action buttons present with icons', 5, async () => {
    const leftCol = page.locator('.banking-agent-panel .ba-left-col');
    await expect(leftCol).toContainText('🏦');        // My Accounts
    await expect(leftCol).toContainText('📋');        // Recent Transactions
    await expect(leftCol).toContainText('💰');        // Check Balance
    await expect(leftCol).toContainText('⬇');         // Deposit
    await expect(leftCol).toContainText('⬆');         // Withdraw
    await expect(leftCol).toContainText('↔');         // Transfer
    await expect(leftCol).toContainText('🔧');        // MCP Tools
    await expect(leftCol).toContainText('🚪');        // Log Out
  });

  // Collapse panel for remaining checks
  try { await page.getByRole('button', { name: 'Collapse agent' }).click({ timeout: 3000 }); } catch (_) {}

  // ── Category 3: Dashboard Completeness (20 points) ────────────────────────

  await sc.check('Dashboard Completeness › "Your Accounts" section heading', 5, async () => {
    await expect(page.getByRole('heading', { name: 'Your Accounts' })).toBeVisible({ timeout: 10000 });
  });

  await sc.check('Dashboard Completeness › "Recent Transactions" section heading', 5, async () => {
    await expect(page.getByRole('heading', { name: 'Recent Transactions' })).toBeVisible({ timeout: 10000 });
  });

  await sc.check('Dashboard Completeness › Account cards show formatted balance', 5, async () => {
    await expect(page.locator('.user-dashboard')).toContainText('$1,500.00');
  });

  await sc.check('Dashboard Completeness › Transaction rows with type, amount, description', 5, async () => {
    await expect(page.locator('.transaction-row').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.transaction-type').first()).toBeVisible();
    await expect(page.locator('.transaction-amount').first()).toBeVisible();
    await expect(page.locator('.transaction-description').first()).toBeVisible();
  });

  // ── Category 4: Landing Page (15 points) ──────────────────────────────────

  await mockLanding(page);
  await page.goto('/');
  await expect(page.locator('.landing-page')).toBeVisible({ timeout: 15000 });

  await sc.check('Landing Page › "BX Finance" brand in navbar', 3, async () => {
    await expect(page.locator('.brand-name').first()).toHaveText('BX Finance');
  });

  await sc.check('Landing Page › Hero heading "Banking Reimagined with AI Agents"', 3, async () => {
    await expect(page.getByText('Banking Reimagined with AI Agents')).toBeVisible();
  });

  await sc.check('Landing Page › "Revolutionary Features" section with feature cards', 3, async () => {
    await expect(page.getByText('Revolutionary Features')).toBeVisible();
    await expect(page.locator('.feature-card')).toHaveCount(6);
  });

  await sc.check('Landing Page › "How It Works" section with 3 steps', 3, async () => {
    await expect(page.getByText('How It Works')).toBeVisible();
    await expect(page.locator('.step')).toHaveCount(3);
  });

  await sc.check('Landing Page › Customer and Admin sign-in CTAs present', 3, async () => {
    await expect(page.getByRole('button', { name: /Customer sign in/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Admin sign in/i }).first()).toBeVisible();
  });

  // ── Category 5: Data & Error Quality (15 points) ──────────────────────────

  await mockCustomerDashboard(page);
  await page.goto('/dashboard');
  await dismissAgent(page);
  await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });

  await sc.check('Data & Error Quality › No [object Object] or "undefined" in DOM', 5, async () => {
    const text = await page.locator('.user-dashboard').innerText();
    expect(text).not.toContain('[object Object]');
    expect(text).not.toMatch(/\bundefined\b/);
  });

  await sc.check('Data & Error Quality › MCP 502 shows friendly message (no stack trace)', 5, async () => {
    await page.route('**/api/mcp/tool', (r) =>
      r.fulfill({ status: 502, contentType: 'application/json',
        body: JSON.stringify({ message: 'mcp_error: WebSocket connection failed' }) }),
    );
    await openAgentPanel(page);
    await page.locator('.banking-agent-panel').getByRole('button', { name: /My Accounts/i }).click();
    const msgs = page.locator('.banking-agent-messages');
    await expect(msgs).toContainText(/unavailable|not reachable|mcp/i, { timeout: 8000 });
    const txt = await msgs.innerText();
    expect(txt).not.toMatch(/at Object\./);
    try { await page.getByRole('button', { name: 'Collapse agent' }).click({ timeout: 2000 }); } catch (_) {}
    await page.unrouteAll();
  });

  await sc.check('Data & Error Quality › At most 1 toast on dashboard load', 5, async () => {
    await mockCustomerDashboard(page);
    await page.goto('/dashboard');
    await dismissAgent(page);
    await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    const count = await page.locator('.Toastify__toast').count();
    expect(count).toBeLessThanOrEqual(1);
  });

  // ── Category 6: Console & Layout Health (15 points) ───────────────────────

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await mockCustomerDashboard(page);
  await page.goto('/dashboard');
  await dismissAgent(page);
  await expect(page.locator('.user-dashboard')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);

  await sc.check('Console & Layout Health › No console.error on dashboard load', 5, async () => {
    const real = consoleErrors.filter(
      (e) => !e.includes('WebSocket') && !e.includes('net::ERR_ABORTED'),
    );
    expect(real, `Console errors: ${real.join('; ')}`).toHaveLength(0);
  });

  await sc.check('Console & Layout Health › FAB fully within viewport', 5, async () => {
    const fab = page.locator('.banking-agent-fab');
    await expect(fab).toBeVisible({ timeout: 10000 });
    const box = await fab.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  });

  await sc.check('Console & Layout Health › FAB does not overlap logout button', 5, async () => {
    const fabBox = await page.locator('.banking-agent-fab').boundingBox();
    const logoutBox = await page.locator('.logout-btn').boundingBox();
    const noOverlap =
      fabBox.x >= logoutBox.x + logoutBox.width ||
      fabBox.x + fabBox.width <= logoutBox.x ||
      fabBox.y >= logoutBox.y + logoutBox.height ||
      fabBox.y + fabBox.height <= logoutBox.y;
    expect(noOverlap).toBe(true);
  });

  // ── Score Report ────────────────────────────────────────────────────────────

  const { earned, total, lines } = sc.report();
  console.log(lines);

  // Write machine-readable score for CI parsing / trend tracking
  const fs = require('fs');
  const scoreData = {
    timestamp: new Date().toISOString(),
    score: earned,
    total,
    pct: Math.round((earned / total) * 100),
    checks: sc.results,
  };
  fs.writeFileSync('ui-score.json', JSON.stringify(scoreData, null, 2));

  // Hard threshold: below 70 is a CI failure
  expect(
    earned,
    `UI score ${earned}/${total} is below the 70-point minimum. See breakdown above.`,
  ).toBeGreaterThanOrEqual(70);
});
