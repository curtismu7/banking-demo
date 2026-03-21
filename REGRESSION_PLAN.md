# Banking Demo — Regression Plan

> **Purpose:** Prevent feature loss and stop repeating the same errors.  
> Update this file whenever a bug is fixed or a feature is added.

---

## 1. Critical Do-Not-Break Areas

| Area | What breaks if touched | Files |
|---|---|---|
| OAuth admin login | Admin can't log in | `routes/oauth.js`, `config/oauth.js`, `banking_api_server/.env` |
| OAuth user login | Customers can't log in | `routes/oauthUser.js`, `config/oauthUser.js` |
| CRA proxy setup | `/api/*` calls go to wrong port → 500 | `banking_api_ui/src/setupProxy.js`, `banking_api_ui/.env` |
| Session persistence | User logged out on every refresh | `server.js` (session middleware), `routes/oauth.js` `req.session.save()` |
| Config UI / configStore | All PingOne settings lost | `services/configStore.js`, `routes/adminConfig.js` |
| BankingAgent FAB | Agent disappears | `components/BankingAgent.js`, `App.js` |
| Vercel build | Production deployment fails | `banking_api_ui/package.json`, `vercel.json` |

---

## 2. Port Layout (Local Dev)

| Service | Port | Start command |
|---|---|---|
| Banking API (default) | 3001 | `cd banking_api_server && npm start` |
| Banking UI (default) | 3000 | `cd banking_api_ui && npm start` |
| Banking API (run-bank.sh) | **3002** | `bash run-bank.sh` |
| Banking UI (run-bank.sh) | **4000** | `bash run-bank.sh` |
| MCP Server | 8080 | auto-started by run-bank.sh |
| LangChain Agent | 8888 | auto-started by run-bank.sh |
| MasterFlow (OAuth Playground) | 3000 / 3001 | `cd oauth-playground && npm start` |

**Proxy rule:** `banking_api_ui/src/setupProxy.js` reads `REACT_APP_API_PORT` (default 3001).  
`banking_api_ui/.env` sets `REACT_APP_API_PORT=3002` for the run-bank.sh layout.

> ⚠️ If you change the API port, update **both** `run-bank.sh` AND `banking_api_ui/.env`.

---

## 3. Bug Fix Log (reverse-chronological)

### 2026-03-21 — Proxy mismatch → 500 on `/api/auth/oauth/status`
- **Symptom:** Browser console shows `GET /api/auth/oauth/status 500` on startup
- **Root cause:** Banking UI proxy targeted `localhost:3001` (MasterFlow) instead of `localhost:3002` (banking API). The banking API server had crashed with `EADDRINUSE: :::3002` on a prior start attempt — because it was already running from a previous invocation.
- **Fix:** Added `REACT_APP_API_PORT=3002` to `banking_api_ui/.env`; `setupProxy.js` already reads this var.
- **Regression check:** After `run-bank.sh`, open `http://localhost:4000` — browser console must show **no 500 errors** before login.

### 2026-03-21 — BankingAgent not visible on login page
- **Symptom:** 🤖 FAB only appeared after logging in  
- **Root cause:** `<BankingAgent>` was inside `Dashboard.js`/`UserDashboard.js` only (post-auth gate)
- **Fix:** Added `<BankingAgent user={null} />` to the unauthenticated branch in `App.js`; added LOGIN_ACTIONS and `handleLoginAction()` to `BankingAgent.js`
- **Regression check:** Open the app without logging in — 🤖 FAB must be visible. Click it — must show "👑 Admin Login" and "👤 Customer Login" buttons.

### 2026-03-21 — run-bank.sh started on localhost not api.pingdemo.com
- **Symptom:** App opened on `localhost:4000`, not `api.pingdemo.com:4000`
- **Root cause:** `/etc/hosts` entry missing; fallback to localhost is correct behaviour
- **Fix:** Script now checks `/etc/hosts`, warns user, and falls back gracefully
- **Regression check:** `bash run-bank.sh` — if `api.pingdemo.com` not in `/etc/hosts`, script must print warning and continue.

### 2026-03-21 — `run-bank.sh` proxy to wrong API port (500s)
- **Symptom:** After `run-bank.sh`, all `/api/*` calls returned `ECONNRESET` because proxy targeted port 3001
- **Root cause:** `REACT_APP_API_PORT` env var not passed through or `.env` overrode it
- **Fix:** Hardcoded `REACT_APP_API_PORT=3002` in `banking_api_ui/.env`
- **Regression check:** `tail -f /tmp/bank-ui.log` — must NOT show `Could not proxy request ... to http://localhost:3001` after startup.

---

## 4. Pre-Deploy Checklist

Before every `vercel --prod`:

- [ ] `npm run build` succeeds in `banking_api_ui/` (exit 0, no compile errors)
- [ ] No new `console.error` or unhandled promise rejections in browser console
- [ ] Admin login flow works end-to-end: login → callback → `/admin` dashboard
- [ ] User login flow works end-to-end: login → callback → `/dashboard`
- [ ] BankingAgent FAB visible on login page with Admin/Customer login buttons
- [ ] BankingAgent FAB shows banking actions after login (Accounts, Balance, Transfer, etc.)
- [ ] Config UI at `/config` loads and saves PingOne credentials
- [ ] MCP tool calls succeed (Accounts, Transactions, Balance via agent chat)

---

## 5. Known Limitations (not bugs)

| Limitation | Reason | Workaround |
|---|---|---|
| LangChain Agent not on Vercel | Python/FastAPI/WebSocket can't run on Vercel | Run locally alongside the app |
| `run-bank.sh` requires `/etc/hosts` entry for `api.pingdemo.com` | DNS not registered | Script falls back to localhost automatically |
| MCP Server WebSocket closes after each tool call | By design — stateless calls | N/A |
| Unused-vars ESLint warnings in CRA build | Legacy code not yet cleaned up | `// eslint-disable-next-line` per file |

---

## 6. Environment Variable Reference

### `banking_api_server/.env` (local / not in git)
| Variable | Purpose |
|---|---|
| `PORT` | API server port (default 3001; run-bank.sh sets 3002) |
| `SESSION_SECRET` | Express session signing key |
| `CONFIG_ENCRYPTION_KEY` | AES key for config.db; falls back to SESSION_SECRET |
| `PINGONE_ENVIRONMENT_ID` | Hard override (normally set via Config UI) |
| `REACT_APP_CLIENT_URL` | Frontend URL used in OAuth redirect URIs |
| `FRONTEND_ADMIN_URL` | Admin dashboard URL after OAuth callback |
| `FRONTEND_DASHBOARD_URL` | User dashboard URL after OAuth callback |

### `banking_api_ui/.env` (local / not in git)
| Variable | Purpose |
|---|---|
| `PORT` | CRA dev server port (4000 for run-bank.sh layout) |
| `REACT_APP_API_PORT` | Port the CRA proxy forwards `/api/*` to (**3002** for run-bank.sh) |
| `REACT_APP_API_URL` | Absolute API URL used by apiClient.js for direct calls |
| `REACT_APP_CLIENT_URL` | Full frontend URL (for OAuth redirect URIs) |

### Vercel environment variables (production)
| Variable | Where to set |
|---|---|
| `KV_REST_API_URL` | Vercel Storage → KV → auto-injected |
| `KV_REST_API_TOKEN` | Vercel Storage → KV → auto-injected |
| `CONFIG_ENCRYPTION_KEY` | Vercel project settings → Environment Variables |
| `SESSION_SECRET` | Vercel project settings → Environment Variables |
| `NODE_ENV` | `production` |

---

## 7. Quick Smoke Test (5 min)

Run after any change before committing:

```bash
# 1. Start the app
bash /Users/cmuir/P1Import-apps/Banking/run-bank.sh

# 2. Open http://localhost:4000
#    → Login page loads
#    → 🤖 FAB visible bottom-right
#    → Click FAB → "👑 Admin Login" and "👤 Customer Login" appear
#    → Console: NO 500 errors, NO proxy errors

# 3. Click "👑 Admin Login" → redirected to PingOne
#    → After auth → /admin dashboard loads
#    → FAB still visible → banking actions available

# 4. Check logs
tail -20 /tmp/bank-api-server.log   # no ERROR lines for /api/auth/oauth/status
tail -20 /tmp/bank-ui.log           # no "Could not proxy" lines
```
