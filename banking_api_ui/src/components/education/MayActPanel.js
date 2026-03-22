// banking_api_ui/src/components/education/MayActPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function MayActPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What they are',
      content: (
        <>
          <p>
            <strong>may_act</strong> (in T1) is <em>prospective</em> permission: &quot;this OAuth client is allowed to request a delegated token for this user.&quot;
          </p>
          <p>
            <strong>act</strong> (in T2 after exchange) is <em>current fact</em>: &quot;this client <strong>is</strong> acting right now&quot; for this request.
          </p>
          <p>Nobody is &quot;acting&quot; until a valid token exchange produces T2 with <code>act</code>.</p>
        </>
      ),
    },
    {
      id: 'lifecycle',
      label: 'Lifecycle',
      content: (
        <>
          <h3>ISSUE → EXCHANGE → USE</h3>
          <pre className="edu-code">{`T1 (login) may include:
  "may_act": { "client_id": "agent-app", ... }

→ RFC 8693 token exchange at PingOne
→ T2 for MCP audience:

  "act": { "sub": "agent-app", ... }
  "sub": "<user>"
`}</pre>
          <p>T1 shows who <em>may</em> delegate; T2 shows who <em>is</em> delegating for this call.</p>
        </>
      ),
    },
    {
      id: 'attacks',
      label: 'Attack scenarios',
      content: (
        <>
          <ol>
            <li><strong>Rogue service</strong> steals T1 and tries to exchange — caller client_id must match <code>may_act</code>; mismatch → rejected.</li>
            <li><strong>Token without policy</strong> — exchange rejected if <code>may_act</code> / policy does not allow delegation.</li>
            <li><strong>Scope escalation</strong> — requested scopes must be subset of T1 scopes; else rejected.</li>
          </ol>
        </>
      ),
    },
    {
      id: 'rfc8693',
      label: 'RFC 8693 spec',
      content: (
        <>
          <p>
            <a href="https://datatracker.ietf.org/doc/html/rfc8693" target="_blank" rel="noopener noreferrer">RFC 8693 — OAuth 2.0 Token Exchange</a>
          </p>
          <p>
            <strong>subject_token</strong> — who the action benefits (the user). <strong>actor_token</strong> — optional; identifies the OAuth client acting (machine client credentials token).
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="may_act and act claims"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
