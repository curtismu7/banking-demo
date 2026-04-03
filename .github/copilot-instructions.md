# BX Finance — GitHub Copilot Instructions

## UI changes require running the harness first

```bash
npm run test:e2e:score    # 100-point scored baseline — see what's present
npm run test:e2e:quality  # 22 pass/fail quality checks
```

Never submit a UI change that lowers the score or breaks a quality check.

---

## Protected UI elements — do not remove or rename

The following CSS classes are tested by the automated harness. Removing or renaming
them will fail CI and lower the UI score.

### Token Chain (`TokenChainDisplay.js`)
`.tcd-root`, `.tcd-header-title`, `.tcd-tabs`, `.tcd-tab`, `.tcd-badge`, `.tcd-legend`, `.token-info-btn`

### Banking Agent (`BankingAgent.js`)
`.banking-agent-fab` (icon: 🏦), `.banking-agent-panel`, `.ba-title` ("BX Finance AI Agent"),
`.ba-left-col`, `.ba-right-col`, `.ba-action-item` × 8 (🏦📋💰⬇⬆↔🔧🚪),
`.ba-server-chip`, `.banking-agent-messages`, `.ba-input`, `.ba-send-btn`

### Dashboard (`UserDashboard.js`)
`.user-dashboard`, `.accounts-grid`, `.account-card`, `.balance`, `.transactions-table`,
`.transaction-row`, `.transaction-date`, `.transaction-type`, `.transaction-amount`,
`.transaction-description`, `.interface-indicator`, `.logout-btn`, `.token-info-btn`

### Landing (`LandingPage.js`)
`.brand-name` ("BX Finance"), `.feature-card` × 6, `.step` × 3

---

## Formatting rules — always apply

- Currency: `$1,500.00` (never raw `1500` or `1500.0`)
- Dates: human-readable (never ISO 8601 strings like `2026-03-01T10:00:00.000Z`)
- Errors: friendly sentence (never `at Object.` stack traces visible to users)
- Toasts: at most 1 on page load (never a storm of duplicate notifications)

---

## Full quality contract

See `docs/ui-quality-criteria.md` — 6 criteria, point values, and the regression history
showing which past incident each rule prevents.
