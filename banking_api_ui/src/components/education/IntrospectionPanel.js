// banking_api_ui/src/components/education/IntrospectionPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function IntrospectionPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'why',
      label: 'What & Why',
      content: (
        <>
          <p>
            The MCP server can call PingOne&apos;s <strong>token introspection</strong> endpoint (RFC 7662) with the presented access token.
            PingOne returns <code>active</code> and claim values — useful when you need <code>act</code> and fresh revocation status without holding JWKS locally.
          </p>
          <p>Activity logs in this demo capture user actions; token <code>act</code> / subject identity flows relate to how the AS records delegation.</p>
        </>
      ),
    },
    {
      id: 'reqres',
      label: 'Request / Response',
      content: (
        <>
          <pre className="edu-code">{`POST /as/introspect
Content-Type: application/x-www-form-urlencoded

token=<T2>&token_type_hint=access_token
&client_id=...&client_secret=...`}</pre>
          <pre className="edu-code">{`200 OK
{
  "active": true,
  "sub": "...",
  "aud": "...",
  "scope": "banking:read",
  "exp": 1234567890,
  "act": { ... }
}`}</pre>
          <p>Expired or revoked tokens typically return <code>&quot;active&quot;: false</code>.</p>
        </>
      ),
    },
    {
      id: 'vsjwks',
      label: 'vs JWKS',
      content: (
        <>
          <p><strong>Introspection:</strong> round-trip to AS; good for <code>act</code>, revocation, opaque tokens.</p>
          <p><strong>JWKS local validation:</strong> fast, offline signature check; Banking API often uses JWKS for JWTs.</p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Token introspection (RFC 7662)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
