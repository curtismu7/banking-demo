# BX Finance — PingGateway MCP Security Layer: Implementation Plan

_Source document: "Securing AI Agents with PingOne using Delegation and Least Privilege"_
_Last updated: 2026-03-27_

---

## Decision: Extend the existing app, not a new one

**Short answer: extend BX Finance.**

The PDF describes the same banking chatbot use case — a digital assistant acting on behalf
of a customer to read balances and make transfers. BX Finance already implements the core
pattern: Authorization Code + PKCE → user token with `may_act` → RFC 8693 token exchange
→ MCP token with `act` claim → MCP server.

The PDF adds **two layers BX Finance is missing**:

1. **PingGateway** as a security enforcement proxy in front of the MCP server
2. **AI Agent registered as a first-class PingOne identity** (Applications > AI Agents)
   plus a mandatory **user consent agreement**

Everything else — React UI, Express BFF, MCP server, Token Chain Display — stays.
A new app would throw away working infrastructure. These are targeted additions.

---

## Current state vs PDF pattern

### Token chain comparison

```
PDF pattern:
  User → Banking Web App (OIDC/PKCE) → User Token (may_act)
  Agent → PingOne Client Credentials → Actor Token
  Agent → Token Exchange (subject=User, actor=Agent) → MCP Token (act+sub, aud=PingGateway URL)
  Agent → PingGateway /mcp (Bearer: MCP Token) → MCP Server

BX Finance today:
  User → Banking Web App (OIDC/PKCE) → User Token (may_act)  ✅
  BFF → PingOne Client Credentials → Actor Token [OPTIONAL, env flag]  ⚠️ off by default
  BFF → Token Exchange (subject=User, actor=BFF) → MCP Token (act+sub)  ✅
  BFF → ws://localhost:8080 (agentToken in WS handshake) → MCP Server  ❌ no PingGateway
```

### Gap analysis

| PDF Requirement | BX Finance Today | Gap |
|---|---|---|
| OIDC Web App (Banking Web App) with PKCE | ✅ user_client_id | None |
| Custom `test` resource (aud = PingGateway URL) | ⚠️ uses MCP_RESOURCE_URI, may not match PingGateway URL | Config update needed |
| Custom `agent` resource with `may_act` attribute expression | ⚠️ may_act works but attribute expression not configured to PDF spec | PingOne config update |
| Consent Agreement ("Agent Consent") | ❌ Not present | New PingOne config + UI step |
| Authentication Policy with Agreement Prompt step | ❌ Not present | New PingOne config |
| AI Agent registered in PingOne (Applications > AI Agents) | ⚠️ Uses generic OAuth client with AGENT_OAUTH_CLIENT_ID | Replace with proper AI Agent registration |
| Actor token via Client Credentials | ⚠️ Implemented but disabled by default (USE_AGENT_ACTOR_FOR_MCP=false) | Enable + point to AI Agent client |
| Token exchange with both subject_token + actor_token | ⚠️ Code exists, env flag off | Enable by default |
| MCP Token audience = PingGateway URL | ⚠️ Audience is MCP_RESOURCE_URI, needs to match PingGateway | Config: set MCP_RESOURCE_URI=https://ig.example.com:8443/mcp |
| PingGateway route protecting MCP server | ❌ BFF talks directly to MCP via WebSocket | New: PingGateway in front |
| PingGateway: McpProtectionFilter + McpAuditFilter | ❌ | New PingGateway config |
| PingGateway: token introspection via PingOne | ❌ | New PingGateway config |
| MCP audit log (mcp.audit.json) | ❌ | Comes free with PingGateway |
| Token Chain Display shows 3-token chain | ✅ Already shows actor + exchange + MCP token | Minor label update for PingGateway context |

---

## What changes, where

### A. PingOne configuration changes (no code changes)

These are admin console clicks, not code. Document them as a setup guide.

**A1. Register the AI Agent (Applications > AI Agents)**

In PingOne admin console → Applications > AI Agents → + Add:

| Field | Value |
|---|---|
| Name | BX Finance AI Agent |
| Grant Types | Client Credentials, Refresh Token, Token Exchange |
| Redirect URI | http://localhost:3000/callback (local) / https://your-vercel-app.vercel.app/callback |
| Resources | agent scope + test scope (see A3) |
| Policy | Agent-Consent-Login (see A5) |

Then copy the Client ID and Client Secret → set as `AGENT_OAUTH_CLIENT_ID` and
`AGENT_OAUTH_CLIENT_SECRET` in the BFF environment.

_Previously BX Finance used a generic OIDC client for this. The AI Agent registration
gives the agent its own identity class in PingOne, enabling proper delegation tracking._

---

**A2. Update custom resources**

**`test` resource** (audience = PingGateway MCP URL):

| Field | Value |
|---|---|
| Name | test |
| Audience | https://ig.example.com:8443/mcp |
| `sub` attribute expression | `#root.context.requestData.subjectToken.sub` |
| `act` attribute expression | `(#root.context.requestData.subjectToken.may_act.sub == #root.context.requestData.actorToken.client_id)?#root.context.requestData.subjectToken.may_act:null` |
| Scope | test |

Copy the Resource ID and Client Secret for PingGateway configuration.

**`agent` resource** (audience = "agent"):

| Field | Value |
|---|---|
| Name | agent |
| Audience | agent (default) |
| `sub` attribute | Username (PingOne Mappings) |
| `may_act` attribute expression | `(#root.context.requestData.grantType == "client_credentials")?null:({ "sub": #root.context.appConfig.clientId })` |
| Scope | agent |

_The `may_act` expression on the `agent` resource is the key: it asserts that the agent
(client_id) is allowed to act on behalf of the user. Only set when the user is doing an
Authorization Code flow, not when the agent is doing Client Credentials._

---

**A3. Add Consent Agreement**

PingOne admin console → User Experience > Agreements → +:

| Field | Value |
|---|---|
| Name | Agent Consent |
| Description | Consent for a digital assistant agent |
| Reconsent Every | 180 days |
| Language | English (en) |
| Agreement text | I consent to allow BX Finance AI agents created by [Your Company] to act on my behalf |

Enable the agreement after saving.

---

**A4. Add Authentication Policy**

PingOne admin console → Authentication > Authentication → + Add Policy:

| Field | Value |
|---|---|
| Name | Agent-Consent-Login |
| Step 1 | Login |
| Step 2 | Agreement Prompt → Agent Consent |

---

**A5. Update BFF OIDC Web App (user_client_id)**

The user's OIDC web app needs the `agent` resource scope so PingOne can embed `may_act`
in the user token during Authorization Code flow:

- Resources tab → add `agent` scope

_Without this the user token has no `may_act` claim and the token exchange cannot
produce an `act` claim on the MCP token._

---

### B. BFF environment variable changes

_No code changes. Just `.env` / Vercel environment variable updates._

```bash
# Enable the two-token (actor + subject) exchange
USE_AGENT_ACTOR_FOR_MCP=true

# AI Agent registered in PingOne (Applications > AI Agents)
AGENT_OAUTH_CLIENT_ID=<client id from AI Agent registration>
AGENT_OAUTH_CLIENT_SECRET=<client secret from AI Agent registration>
AGENT_OAUTH_CLIENT_SCOPES=agent

# MCP audience = PingGateway URL (was MCP server URL directly)
MCP_RESOURCE_URI=https://ig.example.com:8443/mcp

# MCP server URL = PingGateway (not MCP server directly)
MCP_SERVER_URL=https://ig.example.com:8443/mcp

# MCP server behind PingGateway (actual MCP server, PingGateway proxies to this)
# PingGateway config points to: http://localhost:8000 (or wherever MCP server runs)
```

---

### C. PingGateway configuration (new infrastructure)

PingGateway is a new infrastructure component. It runs on a separate host/container
(not Vercel — PingGateway is a persistent process). See `docs/session-login-plan.md`
for why persistent processes are better for this use case.

**C1. admin.json — enable SSE streaming**

```json
{
  "adminConnector": { "host": "localhost", "port": 8085 },
  "connectors": [
    { "port": 8080 },
    { "port": 8443, "tls": "ServerTlsOptions-1" }
  ],
  "streamingEnabled": true,
  "heap": [ ... TLS config ... ]
}
```

`streamingEnabled: true` is required for MCP's Server-Sent Events (SSE) transport.

**C2. mcp.json route**

File location:
- Linux: `$HOME/.openig/config/routes/mcp.json`
- Windows: `%appdata%\OpenIG\config\routes\mcp.json`

```json
{
  "name": "mcp",
  "condition": "${find(request.uri.path, '^/mcp')}",
  "properties": {
    "pingOneEnvID": "https://auth.pingone.com/<PingOne Environment ID>",
    "pingOneResourceID": "<PingOne test resource ID>",
    "gatewayUrl": "https://ig.example.com:8443",
    "mcpServerUrl": "http://localhost:8000"
  },
  "baseURI": "&{mcpServerUrl}",
  "heap": [
    { "name": "SystemAndEnvSecretStore-1", "type": "SystemAndEnvSecretStore" },
    {
      "name": "AuditService",
      "type": "AuditService",
      "config": {
        "eventHandlers": [{
          "class": "org.forgerock.audit.handlers.json.JsonAuditEventHandler",
          "config": {
            "name": "json",
            "logDirectory": "&{ig.instance.dir}/audit",
            "topics": ["access", "mcp"]
          }
        }]
      }
    },
    {
      "name": "rsFilter",
      "type": "OAuth2ResourceServerFilter",
      "config": {
        "requireHttps": false,
        "scopes": ["test"],
        "accessTokenResolver": {
          "type": "TokenIntrospectionAccessTokenResolver",
          "config": {
            "endpoint": "&{pingOneEnvID}/as/introspect",
            "providerHandler": {
              "type": "Chain",
              "config": {
                "filters": [{
                  "type": "HttpBasicAuthenticationClientFilter",
                  "config": {
                    "username": "&{pingOneResourceID}",
                    "passwordSecretId": "resource.secret.id",
                    "secretsProvider": "SystemAndEnvSecretStore-1"
                  }
                }],
                "handler": "ForgeRockClientHandler"
              }
            }
          }
        }
      }
    }
  ],
  "handler": {
    "type": "Chain",
    "config": {
      "filters": [
        { "type": "McpAuditFilter", "config": { "auditService": "AuditService" } },
        { "type": "UriPathRewriteFilter", "config": { "mappings": { "/mcp": "/" } } },
        {
          "type": "McpProtectionFilter",
          "config": {
            "resourceId": "&{gatewayUrl}/mcp",
            "authorizationServerUri": "&{pingOneEnvID}/as",
            "resourceServerFilter": "rsFilter",
            "supportedScopes": ["test"],
            "resourceIdPointer": "/aud/0"
          }
        },
        { "type": "McpValidationFilter", "config": { "acceptedOrigins": ".*" } }
      ],
      "handler": {
        "type": "ReverseProxyHandler",
        "config": { "soTimeout": "20 seconds" }
      }
    }
  }
}
```

**Set the resource secret before starting PingGateway:**

```bash
export RESOURCE_SECRET_ID=$(echo -n "<test resource client secret from PingOne>" | base64)
# Important: no trailing newline in the base64 value
```

**PingGateway filter pipeline explained:**

| Filter | Purpose |
|---|---|
| `McpAuditFilter` | Writes MCP tool calls to `audit/mcp.audit.json` — full audit trail |
| `UriPathRewriteFilter` | Strips `/mcp` prefix so backend MCP server receives requests at `/` |
| `McpProtectionFilter` | Validates the MCP token is an on-behalf-of token with correct `act`/`sub` claims |
| `McpValidationFilter` | Validates the MCP protocol envelope (JSON-RPC structure, tool call format) |
| `ReverseProxyHandler` | Proxies validated request to backend MCP server (`http://localhost:8000`) |

---

### D. BFF code changes (minimal)

**D1. Switch MCP connection from WebSocket to HTTPS+SSE**

The current BFF uses a WebSocket connection to the MCP server (`ws://localhost:8080`).
PingGateway's MCP route uses HTTP/HTTPS with SSE (Server-Sent Events), not raw WebSocket.

File: `banking_api_server/services/mcpWebSocketClient.js`

Changes needed:
- Add support for `https://` MCP URLs (HTTPS + SSE transport) alongside existing `ws://` WebSocket
- When `MCP_SERVER_URL` starts with `https://`, use HTTP POST for tool calls with SSE for streaming responses
- Pass MCP token as `Authorization: Bearer <token>` header (not in WS handshake params)

```javascript
// Detect transport from URL scheme
const mcpUrl = getMcpServerUrl();
const transport = mcpUrl.startsWith('https://') || mcpUrl.startsWith('http://')
  ? 'sse'    // PingGateway SSE transport
  : 'ws';    // Direct WebSocket (local dev without PingGateway)
```

This preserves the existing WebSocket path for local development without PingGateway.

**D2. Token Chain Display — update PingGateway hop label**

File: `banking_api_ui/src/components/TokenChainDisplay.js` (display only, no logic change)

Update the "MCP Token → MCP Server" label to "MCP Token → PingGateway → MCP Server"
when the MCP URL contains `ig.example.com` or a configured gateway URL.

**D3. Consent agreement redirect handling**

File: `banking_api_server/routes/oauthUser.js`

PingOne will include the Agreement Prompt step in the Agent-Consent-Login policy.
The consent step happens transparently during the Authorization Code flow — no additional
redirect handling is needed IF the policy is assigned to the user's OIDC Web App.

However, if consent has not been given and the user tries to use the agent, PingOne
may return `access_denied` from the token exchange. Add handling:

```javascript
// In agentMcpTokenService.js — token exchange error handling
if (error.response?.data?.error === 'access_denied') {
  throw new Error('User consent required. Ask the user to re-authenticate and accept the agent consent agreement.');
}
```

---

### E. MCP server changes (minimal)

**E1. Accept HTTP Bearer token (not just WS handshake agentToken)**

File: `banking_mcp_server/src/server/MCPMessageHandler.ts`

When PingGateway proxies to the MCP server, it will validate the token itself and
may forward the validated token in an `Authorization` header or as a PingGateway
context header. Update the MCP server to accept either:

```typescript
// Accept token from Authorization header (PingGateway path)
// OR from agentToken in WS initialize handshake (direct path)
const agentToken =
  request.headers['authorization']?.replace('Bearer ', '') ||
  params.agentToken;
```

Since PingGateway has already validated the token via introspection before forwarding,
the MCP server can optionally trust PingGateway's validation (skip re-introspection)
when the token arrives via the gateway path. Keep introspection on for the direct
(non-gateway) path.

---

## Token chain with PingGateway in place

```
1. User Token  (Authorization Code + PKCE)
   aud: agent
   scope: agent banking:accounts:read ...
   may_act: { sub: <AI Agent client_id> }    ← asserts agent may act for this user

2. Actor Token  (Client Credentials, AI Agent)
   aud: agent
   scope: agent
   client_id: <AI Agent client_id>

3. Token Exchange  (RFC 8693, on-behalf-of)
   subject_token: User Token
   actor_token: Actor Token
   audience: https://ig.example.com:8443/mcp
   scope: test (or banking:accounts:read per tool)

4. MCP Token  (exchanged, on-behalf-of)
   aud: https://ig.example.com:8443/mcp     ← scoped to PingGateway URL
   scope: test
   sub: demouser                             ← original user identity preserved
   act: { sub: <AI Agent client_id> }        ← delegation chain preserved

5. PingGateway  validates MCP Token:
   - Introspects against PingOne /as/introspect
   - Checks scope includes "test"
   - McpProtectionFilter validates act+sub delegation chain
   - McpAuditFilter writes to audit/mcp.audit.json
   - Strips /mcp prefix, forwards to MCP server

6. MCP Server  receives validated request:
   - Authorization header contains MCP Token (already validated by PingGateway)
   - Executes banking tool (get_account_balance, create_transfer, etc.)
   - Returns result via SSE
```

The Token Chain Display in BX Finance already visualises steps 1–4. Step 5 (PingGateway)
can be added as a new hop type ("Gateway Validated") to complete the picture.

---

## Deployment architecture

```
┌─────────────────────────────────────────┐
│  Vercel (existing)                       │
│  ┌──────────┐    ┌─────────────────┐    │
│  │ React SPA│───►│ Express BFF     │    │
│  │ (UI)     │    │ banking_api_    │    │
│  └──────────┘    │ server          │    │
│                  └────────┬────────┘    │
└───────────────────────────┼─────────────┘
                            │ HTTPS + MCP token
                            ▼
┌─────────────────────────────────────────┐
│  PingGateway host (NEW — persistent)    │
│  ig.example.com:8443                    │
│  ┌─────────────────────────────────┐   │
│  │ mcp.json route                  │   │
│  │  McpAuditFilter                 │   │
│  │  McpProtectionFilter            │   │──►  PingOne /as/introspect
│  │  McpValidationFilter            │   │
│  │  ReverseProxyHandler            │   │
│  └────────────────┬────────────────┘   │
└───────────────────┼─────────────────────┘
                    │ HTTP (internal)
                    ▼
┌─────────────────────────────────────────┐
│  MCP Server (existing — Railway/Render) │
│  banking_mcp_server                     │
│  http://localhost:8000                  │
└─────────────────────────────────────────┘
```

---

## Implementation checklist

```
PingOne configuration (admin console — no code)
[ ] A1. Register BX Finance AI Agent (Applications > AI Agents)
        Copy Client ID → AGENT_OAUTH_CLIENT_ID
        Copy Client Secret → AGENT_OAUTH_CLIENT_SECRET
[ ] A2. Create/update "test" resource
        Audience = https://ig.example.com:8443/mcp
        sub expression = #root.context.requestData.subjectToken.sub
        act expression = (may_act.sub == actor.client_id)?may_act:null
        Copy Resource ID + Client Secret → PingGateway config
[ ] A2. Create/update "agent" resource
        may_act expression = (grantType=="client_credentials")?null:{ "sub": clientId }
[ ] A3. Add "Agent Consent" consent agreement
        Enable and add English language with consent text
[ ] A4. Add "Agent-Consent-Login" auth policy (Login + Agreement Prompt)
[ ] A5. Add "agent" scope to user OIDC Web App (user_client_id) resources

BFF environment variables (Vercel dashboard)
[ ] B1. USE_AGENT_ACTOR_FOR_MCP=true
[ ] B2. AGENT_OAUTH_CLIENT_ID=<from A1>
[ ] B3. AGENT_OAUTH_CLIENT_SECRET=<from A1>
[ ] B4. AGENT_OAUTH_CLIENT_SCOPES=agent
[ ] B5. MCP_RESOURCE_URI=https://ig.example.com:8443/mcp
[ ] B6. MCP_SERVER_URL=https://ig.example.com:8443/mcp

PingGateway deployment (new host — persistent process)
[ ] C1. Install PingGateway, configure TLS (see admin.json example in PDF)
[ ] C2. Set RESOURCE_SECRET_ID env var (base64 of test resource client secret)
[ ] C3. Write mcp.json route file (copy from this doc, fill in env/resource IDs)
[ ] C4. Restart PingGateway, verify route loads in log
[ ] C5. Test: curl https://ig.example.com:8443/mcp → expect 401 (no token)
[ ] C6. Test: curl with valid MCP token → expect 200 from MCP server

BFF code changes (banking_api_server)
[ ] D1. Add SSE transport to mcpWebSocketClient.js (detect https:// vs ws://)
[ ] D2. Pass MCP token as Authorization: Bearer header for SSE transport
[ ] D3. Add access_denied error handling in agentMcpTokenService.js

MCP server code changes (banking_mcp_server)
[ ] E1. Accept Authorization header Bearer token (alongside agentToken in WS handshake)
[ ] E2. Skip re-introspection when request arrives from PingGateway (X-ForgeRock-* header)

UI changes (banking_api_ui)
[ ] F1. Add "PingGateway" hop to Token Chain Display when MCP URL is gateway URL
[ ] F2. Update TokenChainDisplay labels: "MCP Token → PingGateway → MCP Server"

Testing
[ ] G1. npm run test:e2e:score — score must not drop
[ ] G2. npm run test:e2e:quality — all 22 + 3 a11y checks pass
[ ] G3. Manual: login → open agent → "My Accounts" → verify Token Chain shows 4 hops
[ ] G4. Manual: check PingGateway audit/mcp.audit.json after a tool call
[ ] G5. Manual: tamper with MCP token → verify PingGateway returns 401
```

---

## Effort estimate

| Area | Effort | Blocker |
|---|---|---|
| PingOne config (A1–A5) | 1–2 hours | PingOne admin access |
| BFF env vars (B1–B6) | 15 minutes | PingGateway deployed first |
| PingGateway deploy + config (C1–C6) | 2–4 hours | Server with persistent process + TLS cert |
| BFF code — SSE transport (D1–D3) | 3–5 hours | — |
| MCP server — Bearer header (E1–E2) | 1–2 hours | — |
| UI — Token Chain 4th hop (F1–F2) | 1–2 hours | — |
| Testing (G1–G5) | 1–2 hours | Everything above |
| **Total** | **~2 days** | PingGateway host is the critical path |

---

## Troubleshooting reference (from PDF)

| Symptom | Check |
|---|---|
| Token exchange fails / `act` claim is null | Verify attribute expressions in `test` and `agent` custom resources match your client IDs exactly |
| PingGateway drops MCP traffic | `streamingEnabled: true` must be set in admin.json |
| Gateway routing errors (404 from MCP server) | `UriPathRewriteFilter` must strip `/mcp` → `/` before reaching MCP server |
| PingGateway returns 401 on valid token | Verify `RESOURCE_SECRET_ID` env var is set without trailing newline |
| `may_act` not in user token | Add `agent` scope to user OIDC Web App resources tab in PingOne |
| Consent agreement not shown | Policy must be attached to the AI Agent app (not the web app) |
