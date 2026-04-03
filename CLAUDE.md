# BX Finance — Claude Code Instructions

## Before touching any UI file

Run the scoring evaluator first so you know the baseline:

```bash
npm run test:e2e:score
```

This prints a 100-point score and lists exactly which elements are present.
**Your changes must not lower the score.** If the score drops, restore the missing elements before committing.

Run the full quality gate after any UI edit:

```bash
npm run test:e2e:quality
```

Both commands work without a live API server (all routes are mocked).

---

## Protected UI elements — never remove or rename these

These elements have been lost to AI drift before. Treat them as immutable contracts.

### Token Chain Display (`banking_api_ui/src/components/TokenChainDisplay.js`)
| Element | CSS class / text |
|---------|-----------------|
| Root container | `.tcd-root` |
| Header title | `.tcd-header-title` — text "Token Chain" |
| Flow description | `.tcd-header-sub` |
| Tabs | `.tcd-tabs`, `.tcd-tab` — "Current call" and "History [N]" |
| Status badges | `.tcd-badge` with variants `--active`, `--acquired`, `--exchanged`, `--failed` |
| Expand/collapse toggles | `aria-label="Expand"` / `aria-label="Collapse"` |
| Legend | `.tcd-legend`, `.tcd-legend-item` |
| Entry point | `.token-info-btn` in dashboard header opens the modal |

### Banking Agent FAB & Panel (`banking_api_ui/src/components/BankingAgent.js`)
| Element | CSS class / text |
|---------|-----------------|
| Floating button | `.banking-agent-fab` — contains 🏦 icon |
| Panel | `.banking-agent-panel` role="dialog" |
| Title | `.ba-title` — text "BX Finance AI Agent" |
| Subtitle | `.ba-subtitle` — shows role + name when logged in |
| Left column | `.ba-left-col` |
| Right column (chat) | `.ba-right-col` |
| Action items | `.ba-action-item` × 8: 🏦 My Accounts, 📋 Recent Transactions, 💰 Check Balance, ⬇ Deposit, ⬆ Withdraw, ↔ Transfer, 🔧 MCP Tools, 🚪 Log Out |
| Server status chips | `.ba-server-chip` — "Banking Tools [N] actions", "PingOne Identity" |
| Message area | `.banking-agent-messages` |
| Input bar | `.ba-input`, `.ba-send-btn` |
| Collapse button | aria-label="Collapse agent" |

### Customer Dashboard (`banking_api_ui/src/components/UserDashboard.js`)
| Element | CSS class / text |
|---------|-----------------|
| Root | `.user-dashboard` |
| Brand logo | `.bank-logo` with `.logo-square` × 4 |
| Brand name | `.bank-name` — "BX Finance" |
| Greeting | `.user-greeting` — "Hello, [Name]" |
| Accounts section | `h2` "Your Accounts", `.accounts-grid`, `.account-card` |
| Account badges | `.account-type-badge` |
| Balances | `.balance` — formatted `$X,XXX.XX` |
| Action buttons | `.deposit-btn`, `.withdraw-btn`, `.select-account-btn` |
| Transactions section | `h2` "Recent Transactions", `.transactions-table`, `.transaction-row` |
| Transaction cells | `.transaction-date`, `.transaction-type`, `.transaction-amount`, `.transaction-description` |
| Interface indicator | `.interface-indicator`, `.interface-icon` — ◉ End User / ◎ AI Agent |
| Token info button | `.token-info-btn` |
| Logout | `.logout-btn` — text "Log Out" |

### Landing Page (`banking_api_ui/src/components/LandingPage.js`)
| Element | CSS class / text |
|---------|-----------------|
| Brand | `.brand-name` — "BX Finance" |
| Hero heading | h1 "Banking Reimagined with AI Agents" |
| Features section | `.features`, `.feature-card` × 6 |
| How It Works | `.how-it-works`, `.step` × 3 |
| CTAs | Buttons "Customer sign in", "Admin sign in" |

---

## Quality rules — always enforce these

These come from `docs/ui-quality-criteria.md`. Do not soften them.

1. **Currency** always formatted as `$X,XXX.XX` — never raw floats like `1500.0`
2. **Dates** always human-readable — never ISO 8601 strings like `2026-03-01T10:00:00.000Z`
3. **Errors** always friendly messages — never stack traces or raw JSON shown to users
4. **Toasts** at most 1 per page load — never a storm of duplicates
5. **FAB** always ≥ 16px from viewport edges, never overlapping the logout button
6. **Console** zero `console.error` on page load (excluding WebSocket aborts in test env)

---

## How this project works

| Package | Role |
|---------|------|
| `banking_api_server` | Express BFF — holds all OAuth tokens server-side in `req.session` |
| `banking_api_ui` | React 18 SPA — session cookies only, never raw tokens in the browser |
| `banking_mcp_server` | TypeScript MCP WebSocket server — NOT on Vercel |

**Auth flow**: PingOne → BFF → RFC 8693 Token Exchange → MCP server → Banking API.
The Token Chain Display visualises every hop. Never skip a hop.

## Test commands

```bash
npm run test:e2e:score     # 100-point scored UI baseline (most useful)
npm run test:e2e:quality   # 22 pass/fail quality checks
npm run test:e2e:ui:smoke  # fast: customer dashboard + landing only
npm run test:api-server    # backend Jest suite
npm run test:mcp-server    # MCP server unit tests
```

## Before committing UI changes — checklist

- [ ] `npm run test:e2e:score` — score did not drop
- [ ] `npm run test:e2e:quality` — all 22 checks pass
- [ ] Token Chain Display still opens from `.token-info-btn`
- [ ] All 8 agent action buttons still present with correct icons
- [ ] FAB visible and not overlapping logout button
- [ ] No new console.error on dashboard or landing
