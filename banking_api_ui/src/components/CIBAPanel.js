/**
 * CIBAPanel.js — Floating CIBA (Client-Initiated Backchannel Authentication) panel
 *
 * A persistent floating button in the bottom-right corner that opens a
 * slide-in drawer explaining CIBA and letting the user trigger / monitor
 * a live CIBA authentication flow.
 *
 * Tabs:
 *   1. What is CIBA  — explainer with sequence diagram
 *   2. Try It        — initiate a live CIBA request and watch it poll
 *   3. How This App Uses It — MCP agent flow, step-up transactions
 *   4. PingOne Setup — what needs to be configured in the admin console
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './CIBAPanel.css';

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------

const SEQUENCE_DIAGRAM = `
1. App (server) ──POST /bc-authorize──▶ PingOne
   { login_hint: "user@bank.com", scope: "openid banking:write",
     binding_message: "Approve $500 transfer" }

2. PingOne ◀─────────────────────────── auth_req_id returned

3. PingOne ──push notification──────▶ User's Phone
   "Banking App: Approve $500 transfer"

4. User taps ✅ Approve on phone

5. App polls POST /token (grant=ciba, auth_req_id=...)
   → authorization_pending (repeat every 5s)
   → tokens returned ✓

6. Tokens stored server-side (never sent to browser)
   Tool call / transaction executes with user context
`;

const MCP_FLOW = `
Without CIBA (current):
  Chat UI → MCP server needs tokens
  → Server returns a URL in chat text
  → User must manually open URL in browser
  → User authenticates, returns to chat
  ⚠  Breaks chat flow, awkward redirect

With CIBA:
  Chat UI → MCP server needs tokens
  → Server sends bc-authorize to PingOne
  → Push notification lands on user's phone
  → User taps Approve — never leaves chat
  → Tokens arrive at server silently
  ✅  Fluid, in-context, no redirect needed
`;

const STEP_UP_FLOW = `
High-value transaction (amount > threshold):

Without CIBA:
  User clicks Transfer $500
  → Server redirects browser to PingOne
  → User authenticates, gets redirected back
  → Page reload, context lost

With CIBA:
  User clicks Transfer $500
  → UI shows "Check your phone" overlay
  → Push: "Banking App: Approve $500 transfer"
  → User taps Approve
  → Transfer executes immediately
  ✅  No redirect, no page reload
`;

/**
 * Same swimlane pattern + RFC callouts as Agent Gateway demo architecture.vsdx:
 * Web Browser SPA → Agent (security strip) → MCP ingress / egress gateway behavior
 * → MCP Server / Tool → Resource Server; 401 → OAuth flows → Bearer retry;
 * OAuth phased with resource indicator (RFC 8707).
 */
const FULL_STACK_DIAGRAM = `
┌──────────────────────────────────────────────────────────────────────────────┐
│ Pattern source: Agent Gateway demo architecture.vsdx (swimlanes + RFC strips) │
└──────────────────────────────────────────────────────────────────────────────┘

  Web Browser SPA
       │
       │  HTTPS (session cookie). No raw OAuth tokens in browser JS.
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agent — security strip: OAuth 2.1 · RFC 8707 · RFC 9728 · RFC 7523 · RFC 8693│
│   ┌─────┐    ┌────────┐    ┌────────────────┐                                 │
│   │ LLM │    │ memory │    │ business logic │   (+ Sidecar / SDK where used)  │
│   └─────┘    └────────┘    └────────────────┘                                 │
└──────────────────────────────────────────────────────────────────────────────┘
       │ REST / WebSocket to BFF                         │
       │                                                 │
       ▼                                                 ▼
┌──────────────────────────────┐            ┌──────────────────────────────────┐
│ MCP ingress (gateway role)   │            │ IDP / AS — PingOne              │
│ • Introspection + scope       │            │ /authorize · /token ·           │
│   enforcement for tools       │            │ introspect (RFC 7662) · JWKS    │
│ • MCP authZ RFC 9728          │◀───────────│ Resource indicators RFC 8707   │
│   (client ↔ authorization)    │            │ in authorize + token requests  │
└──────────────┬───────────────┘            └──────────────────────────────────┘
               │
               │ MCP egress (outbound to MCP server / token actuation)
               │ • Full RFC 9728 + RFC 8707 sequence with MCP peer
               │ • Token exchange RFC 8693 with secure binding:
               │   JWT client auth RFC 7523 or DPoP RFC 9449 (best practice)
               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MCP Server                              Tool                                  │
│   tools/list · tools/call               API Key / Bearer to downstream       │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
                               │  Bearer access token (audience = Resource Server)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Resource Server (RS) — Banking API HTTPS                                      │
│ RS validates token + audience (https://…/api) + scopes                        │
└──────────────────────────────────────────────────────────────────────────────┘

  Tool call without acceptable token:
       HTTP/1.1 401 Unauthorized  →  "attempt run tool"
       → OAuth flows (PKCE in browser, or CIBA, or token exchange on BFF)
       → "attempt again with bearer token"

  MCP spec: clients MUST support Resource Indicators (RFC 8707) for OAuth —
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

── Phased OAuth with resource indicator (RFC 8707) — same structure as ref diagram ──
  Phase 1  Authorization request  GET /authorize?…&resource=<RS URL>
  Phase 2  Token request          POST /token  grant=authorization_code &resource=<RS>
           AS limits audience to the requested resource
  Phase 3  Resource access       GET …  Authorization: Bearer <AT for RS>

── Optional: ID-JAG / XAA (draft) — identity assertion authorization grant ──
  https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/

── This banking demo maps: Web SPA → Banking BFF → PingOne AS → MCP server → Banking RS ──
   CIBA: POST /bc-authorize + poll /token  (parallel track for push approval)
`;

const OAUTH_API_CHEATSHEET = `
Browser-visible (same origin as app):
  GET  /api/auth/oauth/login              Start admin OAuth (redirect to PingOne)
  GET  /api/auth/oauth/user/login         Start end-user OAuth
  GET  /api/auth/oauth/redirect-info      JSON: exact redirect_uri values for PingOne
Server-only (after login):
  GET  /api/auth/oauth/status             Admin session + userinfo
  GET  /api/auth/oauth/user/status        End-user session
MCP / agent:
  POST /api/mcp/tool                      BFF → optional token exchange → MCP tools/call
  GET  /api/mcp/inspector/tools           BFF MCP inspector: tools/list
  POST /api/mcp/inspector/invoke          BFF MCP inspector: tools/call
CIBA (when enabled):
  POST /api/auth/ciba/initiate            Start backchannel auth
  GET  /api/auth/ciba/poll/:authReqId     Poll until approved or denied
`;

const PINGONE_STEPS = [
  {
    step: '1',
    title: 'Enable CIBA Grant Type',
    detail: 'PingOne Admin → Applications → (your app) → Grant Types → enable "urn:openid:params:grant-type:ciba"',
  },
  {
    step: '2',
    title: 'Set Token Delivery Mode',
    detail: 'In the CIBA section: Token Delivery Mode = "Poll" (simplest). Set Auth Request Expiry = 300s.',
  },
  {
    step: '3',
    title: 'Enable Push MFA Policy',
    detail: 'Authentication → Policies → (your MFA policy) → ensure Push Notification is enabled (PingID / MS Authenticator).',
  },
  {
    step: '4',
    title: 'Set CIBA_ENABLED=true',
    detail: 'In your .env or Vercel environment variables, add: CIBA_ENABLED=true',
  },
  {
    step: '5',
    title: 'Users Must Have a Registered Device',
    detail: 'Each user needs a push-capable authenticator registered (PingID app or Microsoft Authenticator via Azure AD federation).',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({ id, label, active, onClick }) {
  return (
    <button
      className={`ciba-tab${active ? ' ciba-tab--active' : ''}`}
      onClick={() => onClick(id)}
    >
      {label}
    </button>
  );
}

function CodeBlock({ children }) {
  return (
    <pre className="ciba-code">
      <code>{children}</code>
    </pre>
  );
}

function StatusBadge({ status }) {
  const map = {
    idle:     { color: '#6b7280', label: 'Idle' },
    loading:  { color: '#2563eb', label: 'Initiating…' },
    pending:  { color: '#d97706', label: '⏳ Waiting for approval' },
    approved: { color: '#16a34a', label: '✅ Approved' },
    denied:   { color: '#dc2626', label: '❌ Denied' },
    error:    { color: '#dc2626', label: '⚠ Error' },
    expired:  { color: '#9ca3af', label: 'Expired' },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{ color: s.color, fontWeight: 600, fontSize: '0.9rem' }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// "Try It" tab — live CIBA demo
// ---------------------------------------------------------------------------

function TryItTab({ cibaStatus }) {
  const [emailHint, setEmailHint]   = useState('');
  const [scope, setScope]           = useState('openid profile email');
  const [message, setMessage]       = useState('Banking App - Demo Authentication');
  const [acrValues, setAcrValues]   = useState('');
  const [status, setStatus]         = useState('idle'); // idle|loading|pending|approved|denied|error|expired
  const [authReqId, setAuthReqId]   = useState(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [pollLog, setPollLog]       = useState([]);
  const [expiresAt, setExpiresAt]   = useState(null);
  const [timeLeft, setTimeLeft]     = useState(null);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  const log = (msg) => setPollLog((prev) => [`${new Date().toLocaleTimeString()} — ${msg}`, ...prev].slice(0, 20));

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
  }, []);

  const cancel = useCallback(async () => {
    stopPolling();
    if (authReqId) {
      try { await axios.post(`/api/auth/ciba/cancel/${authReqId}`); } catch (_) {}
    }
    setStatus('idle');
    setAuthReqId(null);
    setPollLog([]);
    setExpiresAt(null);
    setTimeLeft(null);
  }, [authReqId, stopPolling]);

  // Poll effect
  useEffect(() => {
    if (status !== 'pending' || !authReqId) return;
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/auth/ciba/poll/${authReqId}`);
        log(`poll → ${data.status}${data.slow_down ? ' (slow_down)' : ''}`);
        if (data.status === 'approved') {
          stopPolling();
          setStatus('approved');
        }
      } catch (err) {
        const s = err.response?.data?.status;
        if (s === 'denied') {
          stopPolling();
          setStatus('denied');
          setErrorMsg(err.response?.data?.message || 'User denied the request');
          log('denied by user');
        } else if (err.response?.status === 410) {
          stopPolling();
          setStatus('expired');
          log('request expired');
        } else {
          log(`poll error: ${err.message}`);
        }
      }
    }, 5000);
    return stopPolling;
  }, [status, authReqId, stopPolling]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left === 0) stopPolling();
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [expiresAt, stopPolling]);

  const initiate = async () => {
    if (!cibaStatus?.enabled) return;
    setStatus('loading');
    setErrorMsg('');
    setPollLog([]);
    setAuthReqId(null);
    log('initiating CIBA request…');
    try {
      const { data } = await axios.post('/api/auth/ciba/initiate', {
        login_hint: emailHint || undefined,
        scope,
        binding_message: message,
        acr_values: acrValues || undefined,
      });
      setAuthReqId(data.auth_req_id);
      setExpiresAt(Date.now() + data.expires_in * 1000);
      setStatus('pending');
      log(`auth_req_id: ${data.auth_req_id.slice(0, 12)}…  expires in ${data.expires_in}s`);
      log(`push sent to: ${data.login_hint_display}`);
    } catch (err) {
      setStatus('error');
      const d = err.response?.data;
      setErrorMsg(d?.message || d?.error || err.message);
      log(`error: ${d?.message || err.message}`);
    }
  };

  if (!cibaStatus?.enabled) {
    return (
      <div className="ciba-tab-content">
        <div className="ciba-notice ciba-notice--warning">
          <strong>CIBA is not enabled.</strong> Set <code>CIBA_ENABLED=true</code> and
          configure PingOne (see the Setup tab) to try a live demo.
        </div>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: '1rem' }}>
          Once enabled, this tab lets you initiate a real push notification and watch
          the polling loop in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="ciba-tab-content">
      <p className="ciba-section-desc">
        <strong>What you are exercising:</strong> <code>POST /api/auth/ciba/initiate</code> starts a CIBA request at PingOne
        (backchannel). The server returns an <code>auth_req_id</code>. This UI then calls{' '}
        <code>GET /api/auth/ciba/poll/:id</code> until PingOne issues tokens (approved) or returns denied / expired.
        Tokens are written to the <strong>BFF session</strong> — they are not returned to the browser.
      </p>
      <p className="ciba-section-desc">
        Initiate a live CIBA request. A push notification will be sent to the
        registered device for the user's email.
      </p>

      {/* Form */}
      {status === 'idle' || status === 'error' ? (
        <div className="ciba-form">
          <label className="ciba-label">
            User email (login_hint)
            <input
              className="ciba-input"
              type="email"
              value={emailHint}
              onChange={(e) => setEmailHint(e.target.value)}
              placeholder="Defaults to currently logged-in user's email"
            />
          </label>
          <label className="ciba-label">
            Scopes
            <input
              className="ciba-input"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="openid profile email"
            />
          </label>
          <label className="ciba-label">
            Binding message (shown on phone)
            <input
              className="ciba-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label className="ciba-label">
            ACR values (step-up, optional)
            <input
              className="ciba-input"
              value={acrValues}
              onChange={(e) => setAcrValues(e.target.value)}
              placeholder="e.g. Multi_factor"
            />
          </label>
          {status === 'error' && (
            <div className="ciba-notice ciba-notice--error">{errorMsg}</div>
          )}
          <button className="ciba-btn ciba-btn--primary" onClick={initiate}>
            📲 Send Push Notification
          </button>
        </div>
      ) : (
        <div className="ciba-live">
          <div className="ciba-live-status">
            <StatusBadge status={status} />
            {timeLeft !== null && status === 'pending' && (
              <span className="ciba-timer">Expires in {timeLeft}s</span>
            )}
          </div>

          {status === 'pending' && (
            <div className="ciba-notice ciba-notice--info">
              Check the user's registered device for a push notification.<br />
              This panel polls <code>/api/auth/ciba/poll/{authReqId?.slice(0,12)}…</code> every 5 seconds.
            </div>
          )}

          {status === 'approved' && (
            <div className="ciba-notice ciba-notice--success">
              ✅ User approved! Tokens stored server-side in the BFF session.
              They are never sent to this browser.
            </div>
          )}

          {status === 'denied' && (
            <div className="ciba-notice ciba-notice--error">
              ❌ {errorMsg || 'User denied the request or it expired.'}
            </div>
          )}

          {/* Poll log */}
          <div className="ciba-poll-log">
            <div className="ciba-poll-log-title">Poll log</div>
            {pollLog.map((line, i) => (
              <div key={i} className="ciba-poll-line">{line}</div>
            ))}
          </div>

          <button className="ciba-btn ciba-btn--secondary" onClick={cancel}>
            Cancel / Reset
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CIBAPanel component
// ---------------------------------------------------------------------------

export default function CIBAPanel() {
  const [open, setOpen]           = useState(false);
  const [activeTab, setActiveTab] = useState('what');
  const [cibaStatus, setCibaStatus] = useState(null);

  // Fetch CIBA enabled status once
  useEffect(() => {
    axios.get('/api/auth/ciba/status')
      .then(({ data }) => setCibaStatus(data))
      .catch(() => setCibaStatus({ enabled: false }));
  }, []);

  const tabs = [
    { id: 'what',      label: 'What is CIBA' },
    { id: 'fullstack', label: 'Full stack' },
    { id: 'tryit',     label: '▶ Try It' },
    { id: 'appflow',   label: 'App Flows' },
    { id: 'setup',     label: 'PingOne Setup' },
  ];

  return (
    <>
      {/* Floating trigger button */}
      <button
        className={`ciba-fab${open ? ' ciba-fab--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Learn CIBA — backchannel authentication & app flows"
        aria-label="Open CIBA guide and try backchannel authentication"
      >
        <span className="ciba-fab-icon">📲</span>
        <span className="ciba-fab-label">CIBA guide</span>
        {cibaStatus?.enabled && <span className="ciba-fab-dot" title="CIBA enabled" />}
      </button>

      {/* Drawer overlay */}
      {open && (
        <div className="ciba-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {/* Drawer */}
      <div className={`ciba-drawer${open ? ' ciba-drawer--open' : ''}`} role="dialog" aria-modal="true" aria-label="CIBA Panel">
        {/* Header */}
        <div className="ciba-header">
          <div>
            <h2 className="ciba-title">
              Backchannel Authentication
              {cibaStatus?.enabled
                ? <span className="ciba-badge ciba-badge--on">Enabled</span>
                : <span className="ciba-badge ciba-badge--off">Disabled</span>}
            </h2>
            <p className="ciba-subtitle">
              OIDC CIBA plus the full story: OAuth tokens, BFF session, MCP client/server, and API flows — open the <strong>Full stack</strong> tab for the map.
            </p>
          </div>
          <button className="ciba-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="ciba-tabs">
          {tabs.map((t) => (
            <TabButton key={t.id} id={t.id} label={t.label} active={activeTab === t.id} onClick={setActiveTab} />
          ))}
        </div>

        {/* Tab content */}
          <div className="ciba-body">

          {/* ── Full stack (platform map) ── */}
          {activeTab === 'fullstack' && (
            <div className="ciba-tab-content">
              <p className="ciba-section-desc">
                The diagram below uses the <strong>same swimlane pattern and RFC callouts</strong> as{' '}
                <strong>Agent Gateway demo architecture.vsdx</strong> in this repo: Web Browser SPA → Agent (security strip:
                OAuth 2.1, RFC 8707, 9728, 7523, 8693) → MCP ingress / egress → MCP Server / Tool → Resource Server;
                401 → OAuth flows → Bearer retry; phased OAuth with <strong>resource</strong> (RFC 8707). This app maps that
                pattern onto <strong>PingOne</strong>, the <strong>Banking BFF</strong>, and <strong>banking_mcp_server</strong>.
              </p>

              <h3 className="ciba-section-title">Agent Gateway–style architecture map</h3>
              <CodeBlock>{FULL_STACK_DIAGRAM}</CodeBlock>

              <h3 className="ciba-section-title">How this demo maps to the diagram</h3>
              <ul className="ciba-flow-list">
                <li><strong>Web Browser SPA</strong> — React UI; session cookie only (no raw AT/RT in JavaScript).</li>
                <li><strong>Agent / LLM</strong> — LangChain agent + chat widget (separate process); same MCP server as the BFF.</li>
                <li><strong>MCP ingress (gateway role)</strong> — Banking BFF: scope checks, session, <code>/api/mcp/tool</code>, optional introspection.</li>
                <li><strong>MCP egress</strong> — BFF performs RFC 8693 token exchange + WebSocket MCP to the server; RFC 8707 resource for MCP audience when configured.</li>
                <li><strong>IDP / AS</strong> — PingOne (<code>/authorize</code>, <code>/token</code>, introspection).</li>
                <li><strong>MCP Server + Tool</strong> — <code>banking_mcp_server</code>; tools call the Banking API with Bearer + scopes.</li>
                <li><strong>Resource Server (RS)</strong> — Banking REST API (same host as BFF in this deployment).</li>
              </ul>

              <h3 className="ciba-section-title">Key API endpoints (this deployment)</h3>
              <CodeBlock>{OAUTH_API_CHEATSHEET}</CodeBlock>

              <div className="ciba-notice ciba-notice--info">
                <strong>Chat widget / LangChain:</strong> the embedded chat uses a WebSocket to an agent host; that
                agent uses its own MCP client to the same MCP server. The flow is parallel to <code>/api/mcp/tool</code> but
                runs in a different process — both ultimately hit the same MCP tools and Banking API.
              </div>
            </div>
          )}

          {/* ── What is CIBA ── */}
          {activeTab === 'what' && (
            <div className="ciba-tab-content">
              <p className="ciba-section-desc">
                CIBA decouples the <strong>consumption device</strong> (where the app runs) from
                the <strong>authentication device</strong> (the user's phone). No browser redirect.
                No popup. The user gets a push notification and taps Approve.
              </p>

              <h3 className="ciba-section-title">The flow</h3>
              <CodeBlock>{SEQUENCE_DIAGRAM}</CodeBlock>

              <h3 className="ciba-section-title">Key concepts</h3>
              <div className="ciba-cards">
                <div className="ciba-card">
                  <div className="ciba-card-icon">🔑</div>
                  <div>
                    <strong>auth_req_id</strong><br />
                    A short-lived ID returned by PingOne. The server polls this
                    to check if the user has approved.
                  </div>
                </div>
                <div className="ciba-card">
                  <div className="ciba-card-icon">📩</div>
                  <div>
                    <strong>binding_message</strong><br />
                    The text shown on the push notification — e.g. "Approve $500 transfer".
                    Helps the user know exactly what they're approving.
                  </div>
                </div>
                <div className="ciba-card">
                  <div className="ciba-card-icon">📊</div>
                  <div>
                    <strong>Poll vs Ping delivery</strong><br />
                    <em>Poll:</em> server polls the token endpoint every 5s.<br />
                    <em>Ping:</em> PingOne calls your server when the user approves (requires a public callback URL).
                  </div>
                </div>
                <div className="ciba-card">
                  <div className="ciba-card-icon">🛡</div>
                  <div>
                    <strong>BFF pattern</strong><br />
                    Tokens are <em>never</em> sent to the browser. They stay in the
                    server-side session. The browser only sees approval status.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Try It ── */}
          {activeTab === 'tryit' && <TryItTab cibaStatus={cibaStatus} />}

          {/* ── App Flows ── */}
          {activeTab === 'appflow' && (
            <div className="ciba-tab-content">
              <h3 className="ciba-section-title">MCP / AI Agent authentication</h3>
              <p className="ciba-section-desc">
                When the AI Banking Agent needs user tokens to call the Banking API,
                CIBA replaces the awkward "open this URL in your browser" redirect.
                The <strong>Full stack</strong> tab shows how MCP tools, token exchange, and REST APIs connect; here we focus on why CIBA helps chat and agent flows.
              </p>
              <CodeBlock>{MCP_FLOW}</CodeBlock>

              <h3 className="ciba-section-title">Step-up auth for high-value transactions</h3>
              <p className="ciba-section-desc">
                Transactions above <strong>STEP_UP_AMOUNT_THRESHOLD</strong> (default $250) require
                additional authentication. CIBA makes this seamless.
              </p>
              <CodeBlock>{STEP_UP_FLOW}</CodeBlock>

              <h3 className="ciba-section-title">API endpoints (this server)</h3>
              <div className="ciba-endpoint-table">
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--post">POST</span>
                  <code>/api/auth/ciba/initiate</code>
                  <span className="ciba-endpoint-desc">Trigger a push notification for the current user</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--get">GET</span>
                  <code>/api/auth/ciba/poll/:id</code>
                  <span className="ciba-endpoint-desc">Check approval status — returns pending / approved / denied</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--get">GET</span>
                  <code>/api/auth/ciba/status</code>
                  <span className="ciba-endpoint-desc">Returns whether CIBA is enabled and the delivery mode</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--post">POST</span>
                  <code>/api/auth/ciba/cancel/:id</code>
                  <span className="ciba-endpoint-desc">Cancel a pending request</span>
                </div>
                <div className="ciba-endpoint-row">
                  <span className="ciba-method ciba-method--post">POST</span>
                  <code>/api/auth/ciba/notify</code>
                  <span className="ciba-endpoint-desc">Ping-mode callback from PingOne (user approved on phone)</span>
                </div>
              </div>
            </div>
          )}

          {/* ── PingOne Setup ── */}
          {activeTab === 'setup' && (
            <div className="ciba-tab-content">
              <p className="ciba-section-desc">
                These steps are done in the <strong>PingOne Admin Console</strong> — no code changes.
              </p>
              <div className="ciba-setup-steps">
                {PINGONE_STEPS.map((s) => (
                  <div key={s.step} className="ciba-setup-step">
                    <div className="ciba-setup-num">{s.step}</div>
                    <div>
                      <strong>{s.title}</strong>
                      <p>{s.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="ciba-section-title">Environment variables</h3>
              <CodeBlock>{`CIBA_ENABLED=true
CIBA_TOKEN_DELIVERY_MODE=poll
CIBA_BINDING_MESSAGE=Banking App Authentication
CIBA_POLL_INTERVAL_MS=5000
CIBA_AUTH_REQUEST_EXPIRY=300`}</CodeBlock>

              <div className="ciba-notice ciba-notice--info" style={{ marginTop: '1rem' }}>
                <strong>Azure AD users?</strong> If PingOne federates to Azure AD, users
                already have Microsoft Authenticator registered. No extra device setup needed —
                PingOne handles the Azure AD lookup via <code>login_hint</code> (email).
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
