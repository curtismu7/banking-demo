// banking_api_ui/src/components/education/AgentGatewayPanel.js
import React from 'react';
import EducationModal from '../shared/EducationModal';

const SWIMLANE = `
Web Browser SPA
     │
     ▼
┌─────────────────────────────────────────┐
│ Agent / MCP ingress (security strip)   │
│  OAuth 2.1 · RFC 8707 · 9728 · 8693     │
└─────────────────┬───────────────────────┘
                  │ MCP tools/call
                  ▼
┌─────────────────────────────────────────┐
│ MCP Server / Tool → Resource Server      │
└─────────────────────────────────────────┘
`;

export default function AgentGatewayPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'overview',
      label: 'Pattern overview',
      content: (
        <>
          <p>
            An <strong>Agent Gateway</strong> sits between the LLM/agent and resource servers: it enforces OAuth, scopes, and token exchange so individual tools stay thin.
            This aligns with the Agent Gateway demo architecture (Visio reference in the repo).
          </p>
        </>
      ),
    },
    {
      id: 'inout',
      label: 'Ingress vs Egress',
      content: (
        <>
          <p><strong>Ingress</strong> — validate every <code>tools/call</code>, scopes, and token shape before work runs.</p>
          <p><strong>Egress</strong> — when calling an external MCP peer, perform RFC 8693 exchange for a peer-scoped token.</p>
          <pre className="edu-code">{SWIMLANE}</pre>
        </>
      ),
    },
    {
      id: 'rfc8707',
      label: 'RFC 8707',
      content: (
        <>
          <p>The <code>resource</code> parameter binds the access token audience to a specific resource server URL at issuance — reducing token replay across unrelated APIs.</p>
          <p>Phase 1: authorize with <code>resource=&lt;RS URL&gt;</code>. Phase 2: token with same resource. Phase 3: call RS; it validates <code>aud</code>.</p>
        </>
      ),
    },
    {
      id: 'rfc9728',
      label: 'RFC 9728 MCP',
      content: (
        <>
          <p>
            <a href="https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc9728bis/" target="_blank" rel="noopener noreferrer">OAuth 2.0 for MCP</a> — authorization server metadata, discovery, and how <code>resource</code> flows through MCP clients.
            This app follows the same conceptual layering; see the floating CIBA guide <strong>Full stack</strong> tab for this deployment&apos;s mapping.
            CIBA approval is delivered by <strong>email or push</strong> depending on PingOne / DaVinci — not chosen in this app.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Gateway pattern (RFC 8707 + RFC 9728)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
