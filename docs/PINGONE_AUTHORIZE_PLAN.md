# PingOne Authorize — implementation plan (banking demo)

This document covers **two interleaved tracks**:

1. **may_act enforcement** — adding `may_act` / `act` claim enforcement to the BFF today, and then migrating that enforcement to PingOne Authorize.
2. **Decision Endpoints alignment** — aligning `pingOneAuthorizeService.js` with the current PingOne Authorize API surface.

It supersedes all ad-hoc notes and should be kept updated as integration points change.

---

## Official documentation (source of truth)

| Topic | URL | Use in this demo |
|-------|-----|-----------------|
| **Authorization using PingOne Authorize (overview)** | [PingOne docs — Authorization using PingOne Authorize](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html) | Product scope: centralized policies for **applications and APIs**, Trust Framework, policies, **decision endpoints**, API Access Management, gateway integrations, tutorials. |
| **Decision Endpoints (Platform API)** | [PingOne Platform APIs — Decision Endpoints](https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints.html) | **Policy decision service** resources: create/read/update/delete **decision endpoints**, query **recent decisions**, and **evaluate decision requests**. |
| **RFC 8693 — OAuth 2.0 Token Exchange** | [datatracker.ietf.org/doc/html/rfc8693](https://datatracker.ietf.org/doc/html/rfc8693) | `act` / `may_act` claim definitions; delegation semantics enforced by the BFF. |

---

## What we own in this repo

| File | Role |
|------|------|
| `banking_api_server/services/agentMcpTokenService.js` | Pre-flight `may_act` description (informational today); will gain enforcement code. |
| `banking_api_server/middleware/actClaimValidator.js` | Validates `act` / `may_act` structure; logs delegation chain. Currently **non-blocking** — must become blocking on `/api/mcp` routes. |
| `banking_api_server/services/pingOneAuthorizeService.js` | Worker token → POST evaluate. Today passes `(userId, amount, type, acr)`. Will also pass delegation context. |
| `banking_api_server/src/__tests__/actClaimValidator.test.js` | Unit tests for claim shape validation. |
| `banking_api_server/src/__tests__/authorize-gate.test.js` | Regression tests for the Authorize gate on `POST /api/transactions`. |

---

## Gap analysis — combined

| # | Area | Current state | Required action |
|---|------|--------------|----------------|
| 1 | `may_act` pre-flight | `describeMayAct()` is **informational only** — exchange proceeds even if `may_act` is absent | Add `REQUIRE_MAY_ACT` guard that blocks exchange with `may_act_required` (Phase 0) |
| 2 | `may_act.client_id` match | No match check against BFF `client_id` | Reject if `may_act.client_id !== bff_client_id` when `REQUIRE_MAY_ACT=true` (Phase 0) |
| 3 | `act` claim enforcement on inbound MCP token | `actClaimValidationMiddleware` runs but **never blocks** | Return `403 delegation_chain_invalid` on `/api/mcp` routes when `act` is absent/invalid (Phase 0) |
| 4 | Delegation context in Authorize call | `evaluateTransaction` receives `(userId, amount, type, acr)` | Add `delegation: { may_act_client_id, act_client_id }` to Authorize context (Phase 1) |
| 5 | Authorize-based `may_act` decision | Not implemented | Replace BFF hard-block with Authorize policy call returning PERMIT/DENY (Phase 1) |
| 6 | API surface mismatch | Service calls `/governance/policyDecisionPoints/{policyId}/evaluate` | Confirm current path vs Decision Endpoints `/authorize/decision-endpoints/{id}/evaluate`; migrate if needed (Phase 2) |
| 7 | Decision endpoint ID config | Single `authorize_policy_id` | Add `authorize_decision_endpoint_id` config if evaluation is keyed by endpoint, not raw PDP id (Phase 2) |
| 8 | Recent decisions audit | Not implemented | Optional: admin/education panel using GET Read Recent Decisions (Phase 3) |

---

## Phase 0 — BFF-level may_act enforcement (TODAY)

> **Goal:** The BFF becomes the enforcement point. No PingOne Authorize call yet — just a hard pre-flight check before RFC 8693 exchange.

### 0-A — `agentMcpTokenService.js`: add `REQUIRE_MAY_ACT` guard

In `resolveMcpAccessTokenWithEvents`, after `appendUserTokenEvent` and before the exchange attempt, add:

```js
// ── may_act pre-flight (Phase 0 enforcement) ─────────────────────────────
const requireMayAct = process.env.REQUIRE_MAY_ACT === 'true';
const bffClientId   = oauthService.config?.clientId || process.env.PINGONE_CLIENT_ID || null;

if (requireMayAct) {
  const { may_act } = t1Claims || {};

  if (!may_act) {
    tokenEvents.push(buildTokenEvent(
      'may-act-blocked',
      'may_act Pre-flight — Blocked',
      'failed',
      null,
      'REQUIRE_MAY_ACT=true but the user token has no may_act claim. ' +
      'Configure a PingOne token policy to add may_act to user access tokens, then sign in again.',
      { rfc: 'RFC 8693 §4.2' }
    ));
    throwTokenResolutionError(
      tokenEvents,
      'may_act_required',
      'REQUIRE_MAY_ACT=true but the user token has no may_act claim. ' +
      'Add may_act via PingOne token policy.',
      403
    );
  }

  if (bffClientId && may_act.client_id && may_act.client_id !== bffClientId) {
    tokenEvents.push(buildTokenEvent(
      'may-act-mismatch',
      'may_act Pre-flight — Client ID Mismatch',
      'failed',
      null,
      `may_act.client_id "${may_act.client_id}" does not match BFF client_id "${bffClientId}". ` +
      'The user token was not issued to authorise this service to exchange it.',
      { rfc: 'RFC 8693 §4.2', expected: bffClientId, got: may_act.client_id }
    ));
    throwTokenResolutionError(
      tokenEvents,
      'may_act_client_id_mismatch',
      `may_act.client_id mismatch: expected ${bffClientId}, got ${may_act.client_id}.`,
      403
    );
  }
}
```

### 0-B — `actClaimValidator.js`: enforce `act` on MCP routes

Add a new exported middleware `requireActClaim` for use on `/api/mcp` routes:

```js
/**
 * Hard-enforce act claim on MCP token calls.
 * Use AFTER actClaimValidationMiddleware on routes that accept
 * tokens that MUST carry a delegation chain.
 *
 * Controlled by ENFORCE_ACT_CLAIM=true env var so it can be
 * enabled incrementally.
 */
function requireActClaim(req, res, next) {
  if (process.env.ENFORCE_ACT_CLAIM !== 'true') return next();

  if (!req.delegationChain?.delegationPresent || !req.actClaimValid) {
    return res.status(403).json({
      error: 'delegation_chain_invalid',
      error_description:
        'This endpoint requires a delegated token with a valid act claim (RFC 8693). ' +
        'The token exchange may not have completed correctly.',
    });
  }
  next();
}
```

Then in `server.js` (or the MCP route file), wire both middlewares:

```js
const { actClaimValidationMiddleware, requireActClaim } = require('./middleware/actClaimValidator');
// ...
app.use('/api/mcp', actClaimValidationMiddleware, requireActClaim, mcpRouter);
```

### 0-C — Environment variables added in Phase 0

| Variable | Default | Purpose |
|----------|---------|---------|
| `REQUIRE_MAY_ACT` | `false` | Block RFC 8693 exchange if `may_act` absent or `client_id` mismatch |
| `ENFORCE_ACT_CLAIM` | `false` | Return 403 on MCP routes when inbound token lacks valid `act` claim |

> **Rollout advice:** Set both to `false` in `.env.local` initially. Enable one at a time per environment to verify PingOne is issuing the claims before enforcement goes live.

### 0-D — Tests to add / update

| File | What to test |
|------|-------------|
| `agentMcpTokenService.test.js` | `REQUIRE_MAY_ACT=true` with absent `may_act` → `may_act_required` error; with wrong `client_id` → `may_act_client_id_mismatch`; with valid `may_act` → exchange proceeds normally |
| `actClaimValidator.test.js` | `requireActClaim` middleware: `ENFORCE_ACT_CLAIM=true` + no `act` → 403; `ENFORCE_ACT_CLAIM=false` → passes through |

---

## Phase 1 — PingOne Authorize for may_act decisions (MIGRATION TARGET)

> **Goal:** Replace the BFF hard-block with a PingOne Authorize policy call. The policy owns the delegation rules — the BFF just enforces the verdict.

### 1-A — What the Authorize policy evaluates

The policy context for a `may_act` check needs:

```json
{
  "context": {
    "user": {
      "id": "<userId>",
      "acr": "<acrValue>"
    },
    "delegation": {
      "may_act_client_id": "<may_act.client_id from T1>",
      "act_client_id":     "<act.client_id from T2 — if already present>",
      "bff_client_id":     "<our own BFF client_id>"
    },
    "request": {
      "resource": "<mcpResourceUri>",
      "scopes":   ["banking:accounts:read"],
      "tool":     "<toolName>"
    }
  }
}
```

Policy rules the Authorize team would configure:
- `may_act.client_id === bff_client_id` → PERMIT delegation
- `may_act` absent but `consentGiven` in user record → conditional PERMIT (or step-up)
- `may_act` absent AND no consent → DENY with obligation `AGENT_CONSENT_REQUIRED`

### 1-B — Code changes

**`pingOneAuthorizeService.js`**: add `evaluateDelegation(params)`:

```js
/**
 * Evaluate whether a token exchange delegation is permitted.
 * Called before RFC 8693 exchange when authorizeEnabled + authorizePolicyId set.
 */
async function evaluateDelegation({ policyId, userId, acr, mayActClientId, actClientId, bffClientId, resource, scopes, tool }) {
  const { envId, regionTld } = _getCredentials();
  if (!envId || !policyId) throw new Error('PingOne Authorize not configured for delegation checks.');

  const workerToken = await getWorkerToken();
  const url = `${apiBase(regionTld)}/v1/environments/${envId}/governance/policyDecisionPoints/${policyId}/evaluate`;

  const payload = {
    context: {
      user:       { id: userId, acr: acr || null },
      delegation: { may_act_client_id: mayActClientId || null, act_client_id: actClientId || null, bff_client_id: bffClientId || null },
      request:    { resource, scopes, tool: tool || null },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Delegation evaluation failed (${response.status}): ${await response.text()}`);

  const raw = await response.json();
  const decision = raw.decision || 'INDETERMINATE';

  // Obligation: AGENT_CONSENT_REQUIRED → surface to UI
  const obligations = raw.obligations || raw.details?.obligations || [];
  const consentRequired = obligations.some(o => (o.type || o.id || '').toUpperCase().includes('CONSENT'));

  return { decision, consentRequired, raw };
}
```

**`agentMcpTokenService.js`**: replace Phase-0 hard-block with Authorize call (when configured):

```js
// ── may_act enforcement: Authorize policy (Phase 1) or BFF hard-block (Phase 0) ──
const authorizeEnabled  = configStore.getEffective('authorize_enabled');
const authorizePolicyId = configStore.getEffective('authorize_policy_id');
const bffClientId       = oauthService.config?.clientId || process.env.PINGONE_CLIENT_ID || null;

if (authorizeEnabled && authorizePolicyId) {
  // Phase 1: delegate decision to PingOne Authorize
  const { decision, consentRequired } = await pingOneAuthorizeService.evaluateDelegation({
    policyId:       authorizePolicyId,
    userId:         userSub,
    acr:            t1Claims?.acr,
    mayActClientId: t1Claims?.may_act?.client_id,
    bffClientId,
    resource:       mcpResourceUri,
    scopes:         toolScopes,
    tool,
  });
  if (decision === 'DENY' || consentRequired) {
    const code = consentRequired ? 'AGENT_CONSENT_REQUIRED' : 'delegation_denied';
    throwTokenResolutionError(tokenEvents, code,
      consentRequired
        ? 'Agent delegation requires user consent. Redirect to consent flow.'
        : 'PingOne Authorize denied this token exchange delegation.',
      403
    );
  }
} else if (process.env.REQUIRE_MAY_ACT === 'true') {
  // Phase 0 fallback: BFF hard-block (see Phase 0-A above)
  // ... existing guard code ...
}
```

### 1-C — Migration checklist (Phase 0 → Phase 1)

- [ ] PingOne Authorize admin: create delegation policy (rules: may_act match, consent, agent allow-list)
- [ ] Set `authorize_policy_id` in Config UI (or env `PINGONE_AUTHORIZE_POLICY_ID`)
- [ ] Set `authorize_enabled=true` in runtimeSettings / Config UI
- [ ] Verify `evaluateDelegation` reaches the policy and returns PERMIT for valid sessions
- [ ] Turn off `REQUIRE_MAY_ACT=true` env var (Phase 0 block no longer needed)
- [ ] Test: deny case → `delegation_denied`; consent case → `AGENT_CONSENT_REQUIRED`

---

## Phase 2 — Decision Endpoints API alignment

> **Goal:** Ensure `pingOneAuthorizeService.js` calls the current, stable PingOne Authorize API surface (Decision Endpoints) rather than an older PDP path.

### 2-A — API surface investigation

The current URL pattern used:

```
POST /v1/environments/{envId}/governance/policyDecisionPoints/{policyId}/evaluate
```

The **Decision Endpoints** API (per [Platform API doc](https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints.html)) exposes:

```
POST /v1/environments/{envId}/authorize/decisionEndpoints/{endpointId}/decisions
```

**Action:** Confirm in the current PingOne Authorize API reference whether:
1. The `policyDecisionPoints` path is still supported (legacy PDP) OR
2. The `decisionEndpoints` path is the current contract

Update `pingOneAuthorizeService.js` to target **one** confirmed URL. Gate the old path behind `USE_LEGACY_PDP=true` env var during transition.

### 2-B — Add `authorize_decision_endpoint_id` config

If Decision Endpoints evaluation is keyed by endpoint ID (not raw policy ID):

```js
// In _getCredentials():
const decisionEndpointId =
  configStore.get('authorize_decision_endpoint_id') ||
  process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID;
```

Map both `authorize_policy_id` (legacy) and `authorize_decision_endpoint_id` (new) so existing deployments migrate without breaking.

### 2-C — Response shape normalisation

Both the PDP and Decision Endpoints APIs may return different shapes. Centralise parsing:

```js
function normaliseAuthorizeResponse(raw) {
  return {
    decision:      raw.decision || raw.result || 'INDETERMINATE',
    obligations:   raw.obligations || raw.details?.obligations || [],
    advice:        raw.advice     || raw.details?.advice     || [],
  };
}
```

---

## Phase 3 — Recent decisions and consent audit

> **Goal:** Surface Authorize decision history in the admin UI for demo and troubleshooting.

- If `recordRecentRequests` is enabled on the decision endpoint, use **GET** *Read Recent Decisions*:
  ```
  GET /v1/environments/{envId}/authorize/decisionEndpoints/{endpointId}/recentDecisions
  ```
- Correlate each `AGENT_CONSENT_REQUIRED` obligation with the decision ID from Authorize for audit narrative.
- Optional admin panel: "last 10 delegation decisions" with PERMIT/DENY/CONSENT columns.

---

## Phase 4 — Broader Authorize features (future)

- **API Access Management** (API services, operations, gateway sidecars) — aligns with `docs/MCP_GATEWAY_PLAN.md` fine-grained controls via PingGateway `McpProtectionFilter`.
- **Step-up for APIs + external OAuth** — extend `checkStepUpRequired` to pass delegation context; tie to `AGENT_CONSENT_ACR` from `docs/pinggateway-agent-plan.md`.
- **Trust Framework attributes** — model `may_act.client_id`, `consentGiven`, `acr` as Trust Framework attributes so policies are composable without code changes.

---

## End-to-end flow (Phase 1 target)

```
User browser
  │  1. Login (Authorization Code + PKCE)
  ▼
PingOne AS ──── issues T1 (user token, includes may_act.client_id = BFF)
  │
  ▼
BFF (banking_api_server)
  │  2. User calls AI Agent tool → BFF calls evaluateDelegation()
  │
  ▼
PingOne Authorize ──── evaluates delegation policy ──── PERMIT / DENY / CONSENT_REQUIRED
  │
  │  3. PERMIT → BFF calls RFC 8693 Token Exchange
  ▼
PingOne AS ──── issues T2 (MCP token, includes act.client_id = BFF, audience = MCP server)
  │
  ▼
banking_mcp_server ──── validates T2 (aud, act, scope) ──── executes tool
```

**Token claims at each hop:**

| Token | Key claims | Issued by |
|-------|-----------|----------|
| T1 (User) | `sub=user`, `may_act={client_id: bff}`, `acr` | PingOne AS after login |
| T2 (MCP) | `sub=user`, `act={client_id: bff}`, `aud=mcp-resource`, `scope=banking:*` | PingOne AS after RFC 8693 exchange |

---

## Files to change (Phases 0–2)

| File | Change |
|------|--------|
| `banking_api_server/services/agentMcpTokenService.js` | Phase 0-A: `REQUIRE_MAY_ACT` guard; Phase 1: Authorize delegation call |
| `banking_api_server/middleware/actClaimValidator.js` | Phase 0-B: `requireActClaim` middleware |
| `banking_api_server/services/pingOneAuthorizeService.js` | Phase 1-B: `evaluateDelegation()`; Phase 2: URL migration, `normaliseAuthorizeResponse()` |
| `banking_api_server/src/__tests__/agentMcpTokenService.test.js` | Phase 0-D: REQUIRE_MAY_ACT tests |
| `banking_api_server/src/__tests__/actClaimValidator.test.js` | Phase 0-D: requireActClaim tests |
| `banking_api_server/src/__tests__/authorize-gate.test.js` | Phase 1-C: delegation evaluation tests |
| `.env.example` / Vercel env | Add `REQUIRE_MAY_ACT`, `ENFORCE_ACT_CLAIM`, `PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID` |

---

## Environment variables (full set)

| Variable | Phase | Default | Purpose |
|----------|-------|---------|---------|
| `REQUIRE_MAY_ACT` | 0 | `false` | BFF hard-block: reject exchange if `may_act` absent or `client_id` mismatch |
| `ENFORCE_ACT_CLAIM` | 0 | `false` | Block MCP routes if inbound token has no valid `act` claim |
| `PINGONE_AUTHORIZE_WORKER_CLIENT_ID` | 0→ | — | Worker app client ID for Authorize calls |
| `PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET` | 0→ | — | Worker app client secret |
| `PINGONE_AUTHORIZE_POLICY_ID` | 0→1 | — | Policy/PDP ID (legacy) |
| `PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID` | 2 | — | Decision Endpoint ID (new API surface) |
| `USE_LEGACY_PDP` | 2 | `false` | Keep calling old PDP URL during migration |

---

## Effort estimate

| Phase | Effort | Blocker |
|-------|--------|---------|
| Phase 0 — BFF enforcement | ~2–4 hours | None — pure BFF code |
| Phase 1 — Authorize delegation policy | ~1 day | PingOne Authorize policy configured and tested |
| Phase 2 — API surface migration | ~2–4 hours | PingOne docs confirm current endpoint URL |
| Phase 3 — Recent decisions UI | ~half day | Phase 2 complete |
| Phase 4 — Broader features | 2+ days | PingGateway host + TLS cert |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `may_act_required` on every call | `REQUIRE_MAY_ACT=true` but PingOne not issuing `may_act` | Configure PingOne token policy to add `may_act.client_id` to user access tokens |
| `may_act_client_id_mismatch` | `may_act.client_id` in token ≠ `PINGONE_CLIENT_ID` env var | Verify token policy injects the correct BFF client ID; check `PINGONE_CLIENT_ID` env var |
| `delegation_denied` from Authorize | Policy DENY — agent or BFF not in allow-list | Check Authorize policy rules; add `may_act.client_id` to policy trust condition |
| `AGENT_CONSENT_REQUIRED` | User has not consented to agent delegation | Redirect to consent flow (see `docs/pinggateway-agent-plan.md` §E) |
| `403 delegation_chain_invalid` on MCP route | `ENFORCE_ACT_CLAIM=true` but T2 lacks `act` | Ensure RFC 8693 exchange used the correct actor token; check PingOne token exchange policy |
| Authorize call returns INDETERMINATE | Policy configured but no matching rule | Add a default DENY rule; check decision logs in PingOne Admin |
| Worker token fails | Wrong credentials or token exchange grant not on worker app | Verify `PINGONE_AUTHORIZE_WORKER_CLIENT_ID` / SECRET; ensure client credentials grant enabled |

---

## References

- [Authorization using PingOne Authorize — overview](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html)
- [PingOne Platform APIs — Decision Endpoints](https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints.html)
- [RFC 8693 — OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) (act / may_act definitions)
- Internal: `banking_api_server/services/agentMcpTokenService.js`, `banking_api_server/services/pingOneAuthorizeService.js`
- Related: `docs/MCP_GATEWAY_PLAN.md` (fine-grained controls via PingGateway), `docs/pinggateway-agent-plan.md` (consent gate + PingGateway route)

---

## Revision history

| Date | Change |
|------|--------|
| 2026-03-27 | Merged may_act enforcement plan (Phase 0) + PingOne Authorize migration plan (Phases 1–4) into unified document. Added delegation context in Authorize call, `evaluateDelegation()` signature, `requireActClaim` middleware spec, full env var table, effort + troubleshooting tables. |
| Earlier | Initial plan: documented Decision Endpoints API alignment and phased Authorize integration. |
