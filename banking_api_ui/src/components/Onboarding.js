import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Public onboarding checklist: what to prepare in PingOne and what to enter on /config.
 */
export default function Onboarding() {
  const headerStyle = {
    background: 'linear-gradient(to bottom, #1e40af 0%, #1e3a8a 100%)',
    color: 'white',
    padding: '1rem 0',
    boxShadow: '0 2px 4px rgba(0,0,0,.15)',
  };

  const cardStyle = {
    background: 'white',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    padding: '1.25rem 1.5rem',
    marginBottom: '1.25rem',
  };

  const olStyle = { margin: '0.5rem 0 0 0', paddingLeft: '1.25rem', color: '#374151', lineHeight: 1.6 };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div style={headerStyle}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Welcome — setup checklist</h1>
            <p style={{ fontSize: '0.875rem', opacity: 0.9, marginTop: '0.35rem', maxWidth: '42rem' }}>
              Configure PingOne OAuth before users can sign in. Review this page first, then enter values on the Application Configuration page.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link to="/" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem' }}>← Sign in</Link>
            <Link
              to="/config"
              style={{
                display: 'inline-block',
                background: 'white',
                color: '#1e3a8a',
                fontWeight: 600,
                fontSize: '0.875rem',
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                textDecoration: 'none',
              }}
            >
              Open Application Configuration
            </Link>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: '2rem 20px', maxWidth: '800px' }}>
        <div style={{ ...cardStyle, background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', color: '#1e3a8a' }}>What you need</h2>
          <p style={{ margin: 0, color: '#1e40af', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            This demo uses <strong>PingOne Advanced Identity Cloud</strong>. On the <strong>Vercel</strong> deployment, OAuth client IDs and secrets (including worker tokens) are <strong>pre-configured on the server</strong> — visitors do not enter PingOne credentials in the app. You still get <strong>both</strong> <em>Admin</em> and <em>Customer</em> sign-in on the login page. On <strong>localhost</strong>, you can configure PingOne apps yourself in Application Configuration (SQLite). Until the API is configured, sign-in may redirect to the configuration page.
          </p>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Admin vs customer — where you land</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            The two buttons on the login page are <strong>not</strong> the same. Each starts a different OAuth flow (admin app vs end-user app). On Vercel those clients are configured in the deployment; locally you map them in Application Configuration.
          </p>
          <ul style={{ ...olStyle, listStyle: 'disc' }}>
            <li><strong>Admin sign-in</strong> — Opens the <em>admin</em> OAuth client. After success you are sent to the <strong>Admin Dashboard</strong> (<code>/admin</code>): activity logs, all users and accounts, security settings, app configuration, MCP Inspector. New demo users from this flow are stored with an <strong>admin</strong> role unless they already existed.</li>
            <li><strong>Customer sign-in</strong> — Opens the <em>end-user</em> OAuth client. After success you go to the <strong>personal dashboard</strong> (<code>/dashboard</code>) with your own accounts and transactions. New users get a <strong>customer</strong> role and sample data.</li>
            <li><strong>Banking Agent</strong> (robot button) — This is <em>not</em> a third login. When you are signed in, agent actions call the API using <strong>your current session</strong> (same person as the main app). When signed out, the agent only helps you start Admin or Customer sign-in (or open reference docs). Open the <strong>CIBA guide → Sign-in &amp; roles</strong> tab for the full picture.</li>
          </ul>
        </div>

        <div style={{ ...cardStyle, borderColor: '#a7f3d0', background: '#f0fdf4' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: '#166534' }}>Vercel (hosted demo)</h2>
          <ol style={olStyle}>
            <li>PingOne OAuth settings (admin client, customer client, Authorize worker, environment ID, etc.) are <strong>stored on the backend</strong> by the deployment — not typed in by visitors.</li>
            <li>The <strong>login page</strong> still offers <strong>Admin sign-in</strong> and <strong>Customer sign-in</strong> — two separate flows using that server-side configuration.</li>
            <li><Link to="/config">Application Configuration</Link> shows <strong>reference</strong> redirect URIs and explains what is deployment-managed; it does not ask for client secrets.</li>
            <li>Operators change credentials via Vercel project environment variables / KV, not through the public UI.</li>
          </ol>
        </div>

        <div style={{ ...cardStyle, borderColor: '#e9d5ff', background: '#faf5ff' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0', color: '#5b21b6' }}>Localhost (development)</h2>
          <ol style={olStyle}>
            <li>You may create <strong>two</strong> PingOne OIDC apps: one for admin sign-in and one for customers — or mirror the Vercel one-app model if you prefer.</li>
            <li>The configuration page shows <strong>Admin OAuth App</strong> and <strong>End-User OAuth App</strong> separately so you can set different client IDs and secrets for each.</li>
            <li>Each redirect URI must match its PingOne app exactly.</li>
            <li>Settings are stored in SQLite on the machine running the API server.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Application Configuration</h2>
          <p style={{ margin: '0 0 0.75rem 0', color: '#4b5563', fontSize: '0.9375rem' }}>
            <strong>Localhost:</strong> Open <Link to="/config">Application Configuration</Link> and complete PingOne Environment, Admin + End-User OAuth apps, Session &amp; Roles, optional Authorize, Advanced. Use <strong>Test PingOne Connection</strong>, then <strong>Save</strong>.
          </p>
          <p style={{ margin: '0.75rem 0 0 0', color: '#4b5563', fontSize: '0.9375rem' }}>
            <strong>Vercel:</strong> The same page is mostly <strong>reference</strong> — OAuth clients and secrets are pre-deployed. You may still see optional settings depending on KV vs read-only mode.
          </p>
          <p style={{ margin: '0.75rem 0 0 0', color: '#4b5563', fontSize: '0.9375rem' }}>
            On that page, expand <strong>MCP Inspector setup</strong> to generate env snippets and commands. For how token exchange works (PingOne <code>/token</code>, HTTP status, responses), open the floating <strong>CIBA guide</strong> → <strong>Token exchange</strong>.
          </p>
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem 0' }}>Deployments (Vercel / read-only)</h2>
          <ul style={{ ...olStyle, listStyle: 'disc' }}>
            <li>If the server shows <strong>read-only mode</strong>, settings must be supplied via environment variables or cloud KV — follow the banner on the configuration page.</li>
            <li>On Vercel, after the first save, updates may require <code>ADMIN_CONFIG_PASSWORD</code> as described on the configuration page.</li>
          </ul>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginTop: '1.5rem' }}>
          <Link
            to="/config"
            className="btn btn-primary"
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Go to Application Configuration
          </Link>
          <Link to="/" style={{ fontSize: '0.9375rem', color: '#2563eb' }}>Return to sign in</Link>
        </div>
      </div>
    </div>
  );
}
