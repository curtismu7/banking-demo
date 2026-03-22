// banking_api_ui/src/components/education/TokenExchangePanel.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import EducationDrawer from '../shared/EducationDrawer';

export default function TokenExchangePanel({ isOpen, onClose, initialTabId }) {
  const [live, setLive] = useState({ loading: false, error: null, t1: null });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLive((s) => ({ ...s, loading: true, error: null }));
      try {
        let r = await axios.get('/api/auth/oauth/status');
        if (!r.data?.authenticated) r = await axios.get('/api/auth/oauth/user/status');
        if (cancelled) return;
        if (r.data?.authenticated && r.data?.accessToken) {
          const parts = r.data.accessToken.split('.');
          let payload = null;
          if (parts.length === 3) {
            try {
              payload = JSON.parse(atob(parts[1]));
            } catch (_) {}
          }
          setLive({ loading: false, error: null, t1: { raw: r.data.accessToken, payload, expiresAt: r.data.expiresAt } });
        } else {
          setLive({ loading: false, error: 'No session token available.', t1: null });
        }
      } catch (e) {
        if (!cancelled) setLive({ loading: false, error: e.message, t1: null });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const tabs = [
    {
      id: 'why',
      label: 'What & Why',
      content: (
        <>
          <h3>Plain English</h3>
          <p>
            <strong>T1</strong> is the user&apos;s access token from the normal login — scoped for PingOne / BFF use. The <strong>MCP server</strong> needs a
            different token (<strong>T2</strong>) with the right <code>audience</code> and often an <code>act</code> claim for delegation.
          </p>
          <p>
            <strong>Token Exchange (RFC 8693)</strong> lets the BFF swap T1 → T2 <em>without</em> sending the user through another browser login.
          </p>
        </>
      ),
    },
    {
      id: 'before',
      label: 'BEFORE (no exchange)',
      content: (
        <>
          <h3>The broken pattern</h3>
          <p>If the BFF forwarded T1 directly to MCP:</p>
          <ul>
            <li>Wrong <code>aud</code> — MCP expects its own resource audience.</li>
            <li>No <code>act</code> claim — delegation not visible at the MCP layer.</li>
            <li>Harder audit trail for &quot;who acted&quot; vs &quot;on behalf of whom&quot;.</li>
            <li>Leaks a broadly scoped user token into the MCP trust boundary.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'after',
      label: 'AFTER (RFC 8693)',
      content: (
        <>
          <h3>Correct flow</h3>
          <p>BFF calls PingOne <code>POST …/as/token</code>:</p>
          <pre className="edu-code">{`grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<T1>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
audience=<MCP resource URI>
scope=<MCP scopes>
# optional delegation:
actor_token=<agent client token>
actor_token_type=urn:ietf:params:oauth:token-type:access_token`}</pre>
          <p><strong>Response</strong> includes T2 access token; JWT may contain <code>act</code> after successful exchange.</p>
        </>
      ),
    },
    {
      id: 'mayact',
      label: 'may_act check',
      content: (
        <>
          <h3>PingOne-style validation (conceptual)</h3>
          <ol>
            <li>Verify T1 signature and expiry.</li>
            <li>Ensure <code>may_act</code> (or policy) allows this client to exchange.</li>
            <li>Caller client id matches allowed actor.</li>
            <li>Requested audience allowed for this exchange.</li>
            <li>Requested scope ⊆ original token scope.</li>
            <li>Issue T2; failures return <code>invalid_grant</code> / policy errors.</li>
          </ol>
        </>
      ),
    },
    {
      id: 'live',
      label: 'Live tokens',
      content: (
        <>
          <h3>Current session (T1)</h3>
          <p>If you are signed in, the demo loads your access token from the OAuth status endpoint (same as the dashboard modal).</p>
          {live.loading && <p>Loading…</p>}
          {live.error && <p style={{ color: '#b91c1c' }}>{live.error}</p>}
          {!live.loading && live.t1?.payload && (
            <>
              <p><strong>Decoded T1 payload (excerpt)</strong></p>
              <pre className="edu-code">{JSON.stringify(live.t1.payload, null, 2)}</pre>
              <p>
                <strong>T2</strong> is minted on the server when MCP needs it — open browser Network on <code>/api/mcp/tool</code> or use MCP Inspector;
                the raw T2 is not stored in the React app.
              </p>
            </>
          )}
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Token exchange (RFC 8693)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
