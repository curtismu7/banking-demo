/**
 * @file banking-agent.spec.js
 * @description Playwright E2E regression tests for the BankingAgent FAB component.
 *
 * Covers:
 *   LOGIN PAGE (unauthenticated)
 *   - FAB is visible on the login page before authentication
 *   - Clicking FAB opens the agent panel
 *   - Panel header shows "Banking Agent" title
 *   - Welcome message mentions signing in
 *   - "👑 Admin Login" button is visible
 *   - "👤 Customer Login" button is visible
 *   - Clicking Admin Login redirects to /api/auth/oauth/login
 *   - Clicking Customer Login redirects to /api/auth/oauth/user/login
 *   - Closing the panel hides it again
 *
 *   AUTHENTICATED (post-login)
 *   - FAB visible after login
 *   - Panel shows banking action buttons (Accounts, Transactions, Balance, etc.)
 *   - "My Accounts" action triggers /api/mcp/tool call with tool=get_my_accounts
 *   - "Recent Transactions" action triggers /api/mcp/tool call
 *   - "Check Balance" shows form with Account ID field, runs get_account_balance
 *   - "Deposit" shows form and submits create_deposit
 *   - "Withdraw" shows form and submits create_withdrawal
 *   - "Transfer" shows form and submits create_transfer
 *   - MCP error (502) shows user-friendly "MCP server not reachable" message
 *   - Cancel on a form hides the form without running the action
 *
 * All API calls and OAuth status are intercepted — no live server required.
 */

const { test, expect } = require('@playwright/test');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER_USER = {
  id: 'user-123',
  username: 'testuser',
  email: 'testuser@bank.com',
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  role: 'user',
};

const SAMPLE_ACCOUNTS = {
  accounts: [
    { id: 'acc_001', account_number: 'CHK-001', account_type: 'checking', balance: 1500.00 },
    { id: 'acc_002', account_number: 'SAV-002', account_type: 'savings',  balance: 8200.50 },
  ],
};

const SAMPLE_TRANSACTIONS = {
  transactions: [
    { id: 'txn_1', type: 'deposit',    amount: 500,   description: 'Payroll',   created_at: '2026-03-01T10:00:00Z' },
    { id: 'txn_2', type: 'withdrawal', amount: 100,   description: 'ATM',       created_at: '2026-03-05T14:30:00Z' },
    { id: 'txn_3', type: 'transfer',   amount: 250,   description: 'Rent',      created_at: '2026-03-10T09:15:00Z' },
  ],
};

const SAMPLE_BALANCE = { balance: 1500.00 };

const SAMPLE_TRANSACTION_CONFIRM = {
  id: 'txn_new_001',
  amount: 100,
  type: 'withdrawal',
};

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Mock both OAuth status endpoints as unauthenticated.
 * This is what App.js sees on the login page.
 */
async function mockUnauthenticated(page) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  // Block unrelated noise
  await page.route('**/ws**', (route) => route.abort());
  await page.route('**/mcp**', (route) => route.abort());
}

/**
 * Mock both OAuth status endpoints as a logged-in customer and stub data APIs.
 */
async function mockAuthenticatedCustomer(page, user = CUSTOMER_USER) {
  await page.route('**/api/auth/oauth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: false, user: null }) })
  );
  await page.route('**/api/auth/oauth/user/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user }) })
  );
  await page.route('**/api/accounts**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_ACCOUNTS) })
  );
  await page.route('**/api/transactions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(SAMPLE_TRANSACTIONS) })
  );
  await page.route('**/ws**', (route) => route.abort());
}

/**
 * Stub /api/mcp/tool to return a given result for one tool call.
 * Subsequent calls with different tools can override by calling this again.
 */
async function mockMcpTool(page, result) {
  await page.route('**/api/mcp/tool', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ result }) })
  );
}

/**
 * Stub /api/mcp/tool to return a 502 (MCP server unavailable).
 */
async function mockMcpToolError(page) {
  await page.route('**/api/mcp/tool', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json',
      body: JSON.stringify({ message: 'mcp_error: WebSocket connection failed' }) })
  );
}

// ─── LOGIN PAGE tests ──────────────────────────────────────────────────────────

test.describe('BankingAgent — Login page (unauthenticated)', () => {

  test('FAB is visible on the login page', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await expect(page.locator('.banking-agent-fab')).toBeVisible();
    await expect(page.locator('.banking-agent-fab')).toHaveText('🤖');
  });

  test('clicking FAB opens the agent panel', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-panel')).toBeVisible();
  });

  test('panel shows "Banking Agent" title', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-title')).toHaveText('Banking Agent');
  });

  test('subtitle shows "How can I help you today?" when not logged in', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-subtitle')).toContainText('How can I help you today');
  });

  test('welcome message mentions signing in', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    const messages = page.locator('.banking-agent-messages');
    await expect(messages).toContainText(/sign in|log in|welcome/i);
  });

  test('"👑 Admin Login" button is visible', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-actions')).toContainText('Admin Login');
  });

  test('"👤 Customer Login" button is visible', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-actions')).toContainText('Customer Login');
  });

  test('clicking Admin Login navigates to /api/auth/oauth/login', async ({ page }) => {
    await mockUnauthenticated(page);
    // Intercept the redirect without actually following it
    await page.route('**/api/auth/oauth/login**', (route) => route.fulfill({
      status: 302, headers: { Location: '/' },
    }));
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();

    const [navReq] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/auth/oauth/login')),
      page.locator('.banking-agent-actions button', { hasText: 'Admin Login' }).click(),
    ]);
    expect(navReq.url()).toContain('/api/auth/oauth/login');
  });

  test('clicking Customer Login navigates to /api/auth/oauth/user/login', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.route('**/api/auth/oauth/user/login**', (route) => route.fulfill({
      status: 302, headers: { Location: '/' },
    }));
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();

    const [navReq] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/auth/oauth/user/login')),
      page.locator('.banking-agent-actions button', { hasText: 'Customer Login' }).click(),
    ]);
    expect(navReq.url()).toContain('/api/auth/oauth/user/login');
  });

  test('clicking close button hides the panel', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-panel')).toBeVisible();
    await page.locator('.banking-agent-close-btn').click();
    await expect(page.locator('.banking-agent-panel')).not.toBeVisible();
  });

  test('clicking FAB again toggles panel closed', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-panel')).toBeVisible();
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-panel')).not.toBeVisible();
  });
});

// ─── AUTHENTICATED tests ───────────────────────────────────────────────────────

test.describe('BankingAgent — Authenticated (customer logged in)', () => {

  test('FAB is visible on the user dashboard', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, SAMPLE_ACCOUNTS);
    await page.goto('/dashboard');
    await expect(page.locator('.banking-agent-fab')).toBeVisible();
  });

  test('panel shows all 6 banking action buttons', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    const actions = page.locator('.banking-agent-actions button');
    await expect(actions).toHaveCount(6);
    await expect(actions.nth(0)).toContainText('My Accounts');
    await expect(actions.nth(1)).toContainText('Recent Transactions');
    await expect(actions.nth(2)).toContainText('Check Balance');
    await expect(actions.nth(3)).toContainText('Deposit');
    await expect(actions.nth(4)).toContainText('Withdraw');
    await expect(actions.nth(5)).toContainText('Transfer');
  });

  // ── Read-only actions ──

  test('"My Accounts" calls get_my_accounts and shows account list', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, SAMPLE_ACCOUNTS);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/mcp/tool') && r.method() === 'POST'),
      page.locator('.banking-agent-actions button', { hasText: 'My Accounts' }).click(),
    ]);

    const body = JSON.parse(req.postData() || '{}');
    expect(body.tool).toBe('get_my_accounts');

    const messages = page.locator('.banking-agent-messages');
    await expect(messages).toContainText('CHK-001');
    await expect(messages).toContainText('$1,500.00');
  });

  test('"Recent Transactions" calls get_my_transactions and shows list', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, SAMPLE_TRANSACTIONS);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/mcp/tool')),
      page.locator('.banking-agent-actions button', { hasText: 'Recent Transactions' }).click(),
    ]);

    const body = JSON.parse(req.postData() || '{}');
    expect(body.tool).toBe('get_my_transactions');

    await expect(page.locator('.banking-agent-messages')).toContainText('Payroll');
  });

  // ── Form-based actions ──

  test('"Check Balance" shows Account ID form', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Check Balance' }).click();
    await expect(page.locator('.banking-agent-form')).toBeVisible();
    await expect(page.locator('label', { hasText: 'Account ID' })).toBeVisible();
  });

  test('"Check Balance" submits get_account_balance and shows balance', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, SAMPLE_BALANCE);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Check Balance' }).click();

    await page.locator('input[placeholder*="acc_"]').first().fill('acc_001');

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/mcp/tool')),
      page.locator('.banking-agent-btn-primary').click(),
    ]);

    const body = JSON.parse(req.postData() || '{}');
    expect(body.tool).toBe('get_account_balance');
    expect(body.params.account_id).toBe('acc_001');

    await expect(page.locator('.banking-agent-messages')).toContainText('Balance: $1,500.00');
  });

  test('"Deposit" shows form with Account ID and Amount fields', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Deposit' }).click();

    const form = page.locator('.banking-agent-form');
    await expect(form).toBeVisible();
    await expect(page.locator('label', { hasText: 'Account ID' })).toBeVisible();
    await expect(page.locator('label', { hasText: 'Amount' })).toBeVisible();
  });

  test('"Deposit" submits create_deposit with correct params', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, { ...SAMPLE_TRANSACTION_CONFIRM, type: 'deposit', amount: 250 });
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Deposit' }).click();

    const inputs = page.locator('.banking-agent-field input');
    await inputs.nth(0).fill('acc_001');          // Account ID
    await inputs.nth(1).fill('250');              // Amount
    await inputs.nth(2).fill('Birthday money');   // Note

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/mcp/tool')),
      page.locator('.banking-agent-btn-primary').click(),
    ]);

    const body = JSON.parse(req.postData() || '{}');
    expect(body.tool).toBe('create_deposit');
    expect(body.params.account_id).toBe('acc_001');
    expect(body.params.amount).toBe(250);

    await expect(page.locator('.banking-agent-messages')).toContainText('✅ Success');
  });

  test('"Withdraw" submits create_withdrawal with correct params', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, { ...SAMPLE_TRANSACTION_CONFIRM, type: 'withdrawal', amount: 100 });
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Withdraw' }).click();

    const inputs = page.locator('.banking-agent-field input');
    await inputs.nth(0).fill('acc_001');
    await inputs.nth(1).fill('100');
    await inputs.nth(2).fill('ATM');

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/mcp/tool')),
      page.locator('.banking-agent-btn-primary').click(),
    ]);

    const body = JSON.parse(req.postData() || '{}');
    expect(body.tool).toBe('create_withdrawal');
    expect(body.params.account_id).toBe('acc_001');
    expect(body.params.amount).toBe(100);

    await expect(page.locator('.banking-agent-messages')).toContainText('✅ Success');
  });

  test('"Transfer" shows form with From, To, Amount and Note fields', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Transfer' }).click();

    const form = page.locator('.banking-agent-form');
    await expect(form).toBeVisible();
    await expect(page.locator('label', { hasText: 'From Account ID' })).toBeVisible();
    await expect(page.locator('label', { hasText: 'To Account ID' })).toBeVisible();
    await expect(page.locator('label', { hasText: 'Amount' })).toBeVisible();
  });

  test('"Transfer" submits create_transfer with correct params', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpTool(page, { ...SAMPLE_TRANSACTION_CONFIRM, type: 'transfer', amount: 500 });
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Transfer' }).click();

    const inputs = page.locator('.banking-agent-field input');
    await inputs.nth(0).fill('acc_001');    // from
    await inputs.nth(1).fill('acc_002');    // to
    await inputs.nth(2).fill('500');        // amount
    await inputs.nth(3).fill('Rent');       // note

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/mcp/tool')),
      page.locator('.banking-agent-btn-primary').click(),
    ]);

    const body = JSON.parse(req.postData() || '{}');
    expect(body.tool).toBe('create_transfer');
    expect(body.params.from_account_id).toBe('acc_001');
    expect(body.params.to_account_id).toBe('acc_002');
    expect(body.params.amount).toBe(500);

    await expect(page.locator('.banking-agent-messages')).toContainText('✅ Success');
  });

  // ── Cancel behaviour ──

  test('Cancel on Withdraw form hides the form without API call', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    let mcpCalled = false;
    await page.route('**/api/mcp/tool', (route) => { mcpCalled = true; route.continue(); });

    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'Withdraw' }).click();
    await expect(page.locator('.banking-agent-form')).toBeVisible();

    await page.locator('.banking-agent-btn-ghost').click();  // Cancel
    await expect(page.locator('.banking-agent-form')).not.toBeVisible();
    expect(mcpCalled).toBe(false);
  });

  // ── Error handling ──

  test('MCP 502 error shows friendly "not reachable" message', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await mockMcpToolError(page);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await page.locator('.banking-agent-actions button', { hasText: 'My Accounts' }).click();

    const messages = page.locator('.banking-agent-messages');
    await expect(messages).toContainText(/unavailable|not reachable|mcp/i);
    // Must NOT show a raw stack trace or JSON dump
    await expect(messages).not.toContainText('at Object.');
  });

  test('login action buttons are NOT shown when user is authenticated', async ({ page }) => {
    await mockAuthenticatedCustomer(page);
    await page.goto('/dashboard');
    await page.locator('.banking-agent-fab').click();
    await expect(page.locator('.banking-agent-actions')).not.toContainText('Admin Login');
    await expect(page.locator('.banking-agent-actions')).not.toContainText('Customer Login');
  });
});
