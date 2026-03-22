# Banking App — Lucidchart Diagrams
# Import: Extensions → Import → Mermaid Diagram (paste one block at a time)

---

## Diagram 1: Component Architecture

```mermaid
flowchart TB
    subgraph BROWSER["Browser (User Device)"]
        UI["React UI\nPort 3000"]
        CHAT["Chat Interface\n(AI)"]
    end

    subgraph BFF["Banking BFF — Port 3001 (Vercel: same domain)"]
        OAUTH["OAuth Routes\n/api/auth/oauth/*\n/api/auth/ciba/*"]
        SESSION["Session Store\n{ accessToken T1\n  refreshToken\n  idToken }"]
        MCPPROXY["MCP Proxy\nPOST /api/mcp/tool\n→ Token Exchange RFC 8693\n→ WS to MCP Server"]
        BANKAPI["Banking API\n/api/accounts\n/api/transactions"]
        AUTH["auth.js middleware\nauthenticateToken()\nrequireScopes()"]
    end

    subgraph MCPSRV["MCP Server — Port 8080 (WebSocket / JSON-RPC)"]
        AUTHMGR["AuthenticationIntegration\ninit: validate token via introspect\ntools/call: check scopes → execute"]
        TOOLS["BankingToolRegistry\nlist_accounts\nget_account_balance\nlist_transactions\ntransfer / deposit / withdraw"]
        INTROSPECT["TokenIntrospector\nPingOne introspection\naud validation\nact claim logging"]
    end

    subgraph AGENT["LangChain Agent — Python (MCP Host)"]
        LLM["ChatOpenAI LLM\nfunction calling"]
        MEM["ConversationMemory"]
        MCPCLIENT["MCPToolProvider\nWS client to MCP Server"]
        CIBAAUTH["OAuthAuthenticationManager\nCIBA initiation + polling"]
    end

    subgraph PINGONE["PingOne"]
        AUTH_EP["/authorize"]
        TOKEN_EP["/token\n• auth_code exchange → issues T1 with may_act\n• token exchange RFC 8693 → validates may_act → issues T2 with act\n• CIBA poll"]
        BCAUTH_EP["/bc-authorize\nCIBA initiation"]
        JWKS_EP["/jwks"]
        INTROSPECT_EP["/introspect\nreturns act claim"]
        USERINFO_EP["/userinfo"]
        SIGNOFF_EP["/signoff"]
        DAVINCI["DaVinci Flow\nCIBA email orchestration"]
    end

    EMAIL["📧 User Email\nApproval link"]

    UI -->|"HTTP + session cookie"| OAUTH
    UI -->|"HTTP + session cookie"| MCPPROXY
    UI -->|"HTTP + session cookie"| BANKAPI
    CHAT -->|"HTTP/WS"| AGENT

    OAUTH -->|"stores tokens"| SESSION
    SESSION -->|"T1 read"| MCPPROXY
    MCPPROXY -->|"RFC 8693\nvalidates may_act"| TOKEN_EP
    MCPPROXY -->|"WS + T2 delegated\nwith act claim"| AUTHMGR
    BANKAPI --> AUTH
    AUTH -->|"JWKS verify"| JWKS_EP

    AUTHMGR --> INTROSPECT
    AUTHMGR --> TOOLS
    INTROSPECT -->|"POST introspect\nreturns act claim"| INTROSPECT_EP
    TOOLS -->|"HTTP Bearer T2"| BANKAPI

    AGENT --> LLM
    AGENT --> MEM
    LLM -->|"tool call"| MCPCLIENT
    MCPCLIENT -->|"WS JSON-RPC + T3"| AUTHMGR
    AGENT --> CIBAAUTH
    CIBAAUTH -->|"POST /bc-authorize"| BCAUTH_EP
    CIBAAUTH -->|"poll POST /token"| TOKEN_EP
    BCAUTH_EP --> DAVINCI
    DAVINCI --> EMAIL

    OAUTH -->|"GET /authorize"| AUTH_EP
    OAUTH -->|"POST /token\n→ T1 + may_act"| TOKEN_EP
    OAUTH -->|"GET /userinfo"| USERINFO_EP
    OAUTH -->|"GET /signoff"| SIGNOFF_EP
```

---

## Diagram 2: Complete Step-by-Step Flow — Login → Token Exchange → Banking Agent Gets Results

```mermaid
sequenceDiagram
    autonumber
    participant U as User / Browser
    participant BFF as Banking BFF
    participant P1 as PingOne
    participant MCP as MCP Server
    participant API as Banking API

    rect rgb(220, 235, 255)
        Note over U,P1: PHASE 1 — Authorization Code Flow (User Login)
        U->>BFF: Click Login
        BFF->>BFF: Generate state (CSRF protection)\nGenerate PKCE code_verifier (random 64 bytes)\nCompute code_challenge = base64url(sha256(verifier))\nDerive redirect_uri from request host
        BFF-->>U: 302 → PingOne /authorize\n?response_type=code\n&client_id=bff-client\n&redirect_uri=https://domain/callback\n&scope=openid profile email banking:*\n&code_challenge=ABC123\n&code_challenge_method=S256\n&state=CSRF_TOKEN
        U->>P1: GET /authorize (browser follows redirect)
        P1-->>U: Login page
        U->>P1: Enter credentials + submit
        P1->>P1: Authenticate user\nApply sign-on policy\nGenerate authorization_code
        P1-->>U: 302 → /callback?code=AUTH_CODE&state=CSRF_TOKEN
    end

    rect rgb(220, 255, 220)
        Note over U,P1: PHASE 2 — Code Exchange + PingOne Issues Token WITH may_act
        U->>BFF: GET /callback?code=AUTH_CODE&state=CSRF_TOKEN
        BFF->>BFF: Validate state = CSRF_TOKEN ✅\nRetrieve code_verifier from session
        BFF->>P1: POST /token\ngrant_type=authorization_code\ncode=AUTH_CODE\ncode_verifier=PKCE_VERIFIER\nclient_id=bff-client\nclient_secret=...
        P1->>P1: Verify code_verifier matches challenge ✅\nIssue T1 with may_act claim\n(PingOne policy: bff-client may act for users)
        P1-->>BFF: T1 = JWT { sub: user123\n  aud: bff-client\n  scope: banking:*\n  may_act: { client_id: bff-client }\n  exp, iat, iss }
        Note over BFF: may_act says:\n"bff-client is ALLOWED to\nexchange this token later"
        BFF->>BFF: session.regenerate() ← prevent session fixation\nStore T1 in session (server-side only)\nNever send T1 to browser
        BFF-->>U: 302 → /dashboard\nSet-Cookie: session=XYZ (httpOnly, secure)
    end

    rect rgb(255, 245, 220)
        Note over U,API: PHASE 3 — User Asks AI Agent for Account Data
        U->>BFF: POST /api/mcp/tool\n{ tool: list_accounts }\nCookie: session=XYZ
        BFF->>BFF: Read T1 from session\nLook up tool scopes:\nlist_accounts → banking:accounts:read
    end

    rect rgb(255, 220, 220)
        Note over BFF,P1: PHASE 4 — RFC 8693 Token Exchange (BFF presents may_act, gets act)
        BFF->>P1: POST /token\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\nsubject_token=T1\nsubject_token_type=access_token\naudience=https://mcp.banking.internal\nscope=banking:accounts:read\nclient_id=bff-client\nclient_secret=...

        Note over P1: PingOne validates may_act (WHY this matters ↓):\n1. Verify T1 signature + not expired\n2. Extract may_act: { client_id: bff-client }\n3. Check authenticated caller = bff-client\n4. caller matches may_act.client_id ✅\n5. Requested audience allowed by policy ✅\n6. Requested scope ⊆ original scope ✅\n→ Without may_act, exchange is REJECTED\n→ Prevents any rogue service from\n   exchanging user tokens it shouldn't have

        P1-->>BFF: T2 = JWT { sub: user123\n  aud: https://mcp.banking.internal\n  scope: banking:accounts:read\n  act: { client_id: bff-client }\n  exp: shorter lifetime }
        Note over BFF: act says:\n"bff-client IS ACTING\nright now for user123"\nT1 never leaves the BFF
    end

    rect rgb(220, 255, 245)
        Note over BFF,API: PHASE 5 — MCP Server Validates Delegation + Executes Tool
        BFF->>MCP: WS initialize\n{ agentToken: T2 }
        MCP->>P1: POST /introspect token=T2
        P1-->>MCP: { active: true\n  sub: user123\n  aud: https://mcp.banking.internal\n  act: { client_id: bff-client }\n  scope: banking:accounts:read }
        MCP->>MCP: aud = mcp resource URI ✅\nact.client_id = known BFF client ✅\nscope sufficient for list_accounts ✅\nLog: "user123 delegated via bff-client"
        MCP-->>BFF: handshake OK

        BFF->>MCP: tools/call { list_accounts }
        MCP->>API: GET /api/accounts\nAuthorization: Bearer T2
        API->>API: Validate T2 (JWKS)\nCheck banking:accounts:read scope ✅\nFilter accounts for sub=user123
        API-->>MCP: [ { id, type, balance }, ... ]
        MCP-->>BFF: tool result
        BFF-->>U: 200 { result: [ accounts ] }
    end
```

---

## Diagram 3: may_act Claim — What It Is, How It's Checked, Why It Matters

```mermaid
flowchart TD
    subgraph ISSUE["Step 1 · ISSUE — PingOne mints T1 after code exchange"]
        T1BOX["T1 — User Access Token\n─────────────────────────\nsub:      user123\naud:      bff-client\nscope:    banking:accounts:read\n          banking:transactions:write\niss:      https://auth.pingone.com/env\nexp:      now + 1h\n─────────────────────────\nmay_act: {\n  client_id: bff-client\n}\n─────────────────────────\nMeaning: bff-client is ALLOWED\nto exchange this token later.\nThis is prospective — nobody\nis acting yet."]
    end

    subgraph EXCHANGE["Step 2 · EXCHANGE — BFF presents T1 to get T2"]
        REQ["BFF → POST /token\n────────────────────────────\ngrant_type  = token-exchange\nsubject_token = T1\naudience    = mcp-server-uri\nscope       = banking:accounts:read\nclient_id   = bff-client\nclient_secret = ****"]

        subgraph CHECK["PingOne Validation — may_act check"]
            C1["① Verify T1 signature\n   and not expired"]
            C2["② Extract may_act from T1\n   → { client_id: bff-client }"]
            C3["③ Who is making this request?\n   → Authenticated as: bff-client"]
            C4["④ Does caller match may_act?\n   bff-client == bff-client ✅\n   If mismatch → REJECT 400\n   exchange_not_allowed"]
            C5["⑤ Is audience allowed by policy?\n   mcp-server-uri → allowed ✅"]
            C6["⑥ Is scope a subset of T1 scope?\n   banking:accounts:read ⊆ banking:* ✅"]
            C7["⑦ All checks pass → issue T2"]
            C1-->C2-->C3-->C4-->C5-->C6-->C7
        end

        T2BOX["T2 — Delegated Token\n─────────────────────────\nsub:   user123\naud:   https://mcp.banking.internal\nscope: banking:accounts:read  ← narrowed\nexp:   shorter lifetime\n─────────────────────────\nact: {\n  client_id: bff-client\n}\n─────────────────────────\nMeaning: bff-client IS ACTING\nfor user123 right now.\nThis is current — delegation\nis happening."]
    end

    subgraph USE["Step 3 · USE — MCP Server receives T2 and validates"]
        INTRO["MCP → POST /introspect T2\nPingOne returns full claims including act"]
        V1["✅ active = true"]
        V2["✅ aud matches MCP_SERVER_RESOURCE_URI\n   (configured in MCP server env)"]
        V3["✅ act.client_id = bff-client\n   (proves BFF performed exchange,\n    not a rogue caller)"]
        V4["✅ scope covers required tool scopes"]
        V5["📋 Audit log:\n   user123 accessed via bff-client delegation\n   tool: list_accounts\n   time: 2026-03-22T..."]
        INTRO-->V1-->V2-->V3-->V4-->V5
    end

    subgraph WHY["Why may_act Prevents Attacks"]
        W1["🚫 Rogue service has user token T1\n   Tries to exchange for MCP token\n   → may_act.client_id = bff-client\n   → Caller authenticated as rogue-svc\n   → Mismatch → REJECTED"]
        W2["🚫 No may_act on token\n   Token issued without delegation policy\n   → may_act missing\n   → Exchange rejected by policy\n   → Prevents delegation of tokens\n      not designed for it"]
        W3["🚫 Scope escalation attempt\n   Requests scope not in T1\n   → Requested scope not a subset\n   → REJECTED"]
    end

    T1BOX --> REQ
    REQ --> CHECK
    CHECK --> T2BOX
    T2BOX --> INTRO
    INTRO --> V1

    T1BOX -.->|"may_act is prospective\npermission"| WHY
    T2BOX -.->|"act is current\nfact"| WHY
```

---

## Diagram 4: Token Exchange — BEFORE (Current State — No Delegation)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant BFF as BFF (3001)
    participant MCP as MCP Server (8080)
    participant API as Banking API
    participant P1 as PingOne

    Note over B,P1: ❌ BEFORE — Raw user token passed by reference, no delegation

    B->>BFF: POST /api/mcp/tool (session cookie)
    BFF->>BFF: Extract T1 from session\n(user's raw access token, aud=BFF)

    Note over BFF,MCP: T1 passed directly — same token the browser flow issued
    BFF->>MCP: WS initialize { agentToken: T1 }
    MCP->>P1: POST /introspect token=T1
    P1-->>MCP: { active, sub=user123, aud=bff ← wrong audience }
    Note over MCP: ⚠️ aud=bff-client, not mcp-server-uri\n❌ no act claim — cannot verify who sent token\n❌ no delegation record for audit\n❌ scope not narrowed for this tool
    MCP-->>BFF: handshake OK (no aud enforcement)
    BFF->>MCP: tools/call { list_accounts }
    MCP->>API: GET /api/accounts Bearer T1
    API-->>MCP: accounts data
    MCP-->>BFF: tool result
    BFF-->>B: 200 { result }

    Note over B,P1: Problems — T1 scoped for BFF, used for MCP (audience mismatch)\nMCP cannot verify BFF sent it (no act claim)\nNo audit trail — just a raw user token\nIf T1 leaks in MCP layer, attacker has the full user token
```

---

## Diagram 5: Token Exchange — AFTER (RFC 8693 with may_act → act)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant BFF as BFF (3001)
    participant P1 as PingOne
    participant MCP as MCP Server (8080)
    participant API as Banking API

    Note over B,API: ✅ AFTER — RFC 8693 Token Exchange with may_act validation and act claim

    B->>BFF: POST /api/mcp/tool { tool: list_accounts } (session cookie)
    BFF->>BFF: Read T1 from session\nT1 contains may_act: { client_id: bff-client }\nTool scope: banking:accounts:read

    BFF->>P1: POST /token\ngrant_type=token-exchange\nsubject_token=T1\naudience=https://mcp.banking.internal\nscope=banking:accounts:read\nclient_id=bff-client
    Note over P1: Validates may_act:\nmay_act.client_id=bff-client == caller ✅\nDownscope scope ✅\nIssue T2 with act claim
    P1-->>BFF: T2 = { sub:user123, aud:mcp-uri\nscope:accounts:read\nact:{ client_id:bff-client } }

    BFF->>MCP: WS initialize { agentToken: T2 }
    MCP->>P1: POST /introspect T2
    P1-->>MCP: { active, sub, aud=mcp-uri, act={ client_id:bff-client } }
    MCP->>MCP: aud=mcp-server-uri ✅\nact.client_id=bff-client ✅\nscope=accounts:read ✅\nAudit: user123 via bff delegation
    MCP-->>BFF: handshake OK
    BFF->>MCP: tools/call { list_accounts }
    MCP->>API: GET /api/accounts Bearer T2
    API->>API: Validate T2 — aud, scope, exp ✅
    API-->>MCP: accounts
    MCP-->>BFF: tool result
    BFF-->>B: 200 { result }
```

---

## Diagram 6: AI Agent (LangChain) Full Flow — CIBA → Token Exchange → Tool Result

```mermaid
sequenceDiagram
    autonumber
    participant U as User Email
    participant LC as LangChain Agent (MCP Host)
    participant P1 as PingOne / DaVinci
    participant MCP as MCP Server (8080)
    participant API as Banking API

    rect rgb(220, 235, 255)
        Note over LC,P1: PHASE 1 — CIBA: Get user token without browser redirect
        LC->>LC: User says "show my accounts"\nfor user@example.com
        LC->>P1: POST /bc-authorize\nlogin_hint=user@example.com\nscope=openid banking:*\nbinding_message=Banking App Access\nclient_id=ai-agent-client
        P1->>P1: Look up user by email\nTrigger DaVinci flow
        P1->>U: 📧 Email: "Approve Banking App access [Approve]"
        P1-->>LC: { auth_req_id: abc-123, expires_in: 300, interval: 5 }
        LC-->>U: "Check your email and click Approve"

        loop Poll every 5s until approved
            LC->>P1: POST /token\ngrant_type=ciba\nauth_req_id=abc-123
            P1-->>LC: { error: authorization_pending }
        end

        U->>P1: User clicks Approve in email
        LC->>P1: POST /token (next poll)
        P1-->>LC: T_ciba = { sub:user123, aud:ai-agent\nmay_act:{ client_id:ai-agent-client }\nscope:banking:* }
    end

    rect rgb(255, 220, 220)
        Note over LC,P1: PHASE 2 — Token Exchange: Narrow to MCP audience with act claim
        LC->>P1: POST /token\ngrant_type=token-exchange\nsubject_token=T_ciba\nactor_token=ai_agent_client_assertion\naudience=https://mcp.banking.internal\nscope=banking:accounts:read\nclient_id=ai-agent-client
        Note over P1: Validates may_act:\nmay_act.client_id=ai-agent-client == caller ✅\nIssue T3 with act claim
        P1-->>LC: T3 = { sub:user123\naud:mcp-server-uri\nact:{ client_id:ai-agent-client }\nscope:banking:accounts:read }
    end

    rect rgb(220, 255, 220)
        Note over LC,API: PHASE 3 — MCP Tool Call with delegated token
        LC->>MCP: WS initialize { agentToken: T3 }
        MCP->>P1: POST /introspect T3
        P1-->>MCP: { active, sub:user123, aud:mcp-uri\nact:{ client_id:ai-agent-client } }
        MCP->>MCP: aud=mcp-server-uri ✅\nact.client_id=ai-agent-client ✅\nAudit: user123 via ai-agent delegation
        MCP-->>LC: handshake OK

        LC->>MCP: tools/call { list_accounts }
        MCP->>API: GET /api/accounts Bearer T3
        API->>API: Validate T3\nCheck banking:accounts:read ✅
        API-->>MCP: [ accounts ]
        MCP-->>LC: tool result

        LC->>LC: LLM formats response
        LC-->>U: "You have 2 accounts:\nChecking $2,400 | Savings $11,200"
    end
```

---

## Diagram 7: CIBA Email Approval Flow

```mermaid
sequenceDiagram
    autonumber
    participant SRV as BFF or MCP Server
    participant P1 as PingOne
    participant DV as DaVinci Flow
    participant U as User Email

    SRV->>P1: POST /bc-authorize\n{ login_hint: user@email.com\n  scope: openid banking:*\n  binding_message: Banking App Access\n  client_id, client_secret }
    P1->>P1: Look up user by email
    P1->>DV: Trigger CIBA flow
    DV->>U: 📧 Email: Approve Banking App access\n[Approve] [Deny]
    P1-->>SRV: { auth_req_id: abc-123\n  expires_in: 300\n  interval: 5 }

    loop Poll every 5 seconds
        SRV->>P1: POST /token\ngrant_type=urn:openid:params:grant-type:ciba\nauth_req_id=abc-123
        P1-->>SRV: { error: authorization_pending }
    end

    U->>DV: User clicks Approve in email
    DV->>P1: Mark auth_req_id approved

    SRV->>P1: POST /token (next poll)
    P1-->>SRV: { access_token: T_user\n  refresh_token: R\n  scope: banking:*\n  may_act: { client_id: ai-agent-client } }

    SRV->>SRV: Store tokens in session\nProceed to token exchange (Diagram 5/6)
```

---

## Diagram 8: may_act Claim Lifecycle — Prospective vs Current

```mermaid
flowchart LR
    subgraph ISSUE["① ISSUE — Code Exchange\nPingOne adds may_act to T1"]
        T1["Token T1\n──────────────\nsub: user123\naud: bff-client\nscope: banking:*\n──────────────\nmay_act: {\n  client_id: bff-client\n}\n──────────────\n🔵 PROSPECTIVE\nSays who MAY act later\nNobody is acting yet"]
    end

    subgraph EXCHANGE["② EXCHANGE — RFC 8693\nPingOne validates may_act, issues T2"]
        CHECK["PingOne checks:\n1. T1 valid + not expired\n2. may_act exists\n3. caller == may_act.client_id\n4. audience allowed by policy\n5. scope ⊆ original scope\n✅ All pass → issue T2\n❌ Any fail → reject 400"]
        T2["Token T2\n──────────────\nsub: user123\naud: mcp-server-uri ← scoped\nscope: accounts:read ← narrowed\n──────────────\nact: {\n  client_id: bff-client\n}\n──────────────\n🟢 CURRENT FACT\nSays who IS acting now\nbff-client is the actor"]
        CHECK --> T2
    end

    subgraph RESOURCE["③ RESOURCE SERVER\nMCP Server validates act"]
        MCP_CHECK["Introspect T2:\n✅ active\n✅ aud = MCP_SERVER_RESOURCE_URI\n✅ act.client_id = bff-client\n✅ scope sufficient\n📋 Audit log:\nuser123 via bff-client\ntime + tool recorded"]
    end

    subgraph ATTACK["What happens without may_act"]
        A1["Rogue service holds T1\nTries token exchange\n→ caller = rogue-svc\n→ may_act.client_id = bff-client\n→ MISMATCH → REJECTED 🚫"]
        A2["Token issued without\nmay_act policy\n→ claim missing\n→ no delegation allowed 🚫"]
        A3["Scope escalation\nRequests broader scope\n→ scope not subset 🚫"]
    end

    T1 --> CHECK
    T2 --> MCP_CHECK
    T1 -.->|"attack attempt"| ATTACK
```
