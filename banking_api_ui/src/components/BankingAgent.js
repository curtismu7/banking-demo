import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMyAccounts,
  getAccountBalance,
  getMyTransactions,
  createTransfer,
  createDeposit,
  createWithdrawal,
} from '../services/bankingAgentService';
import { loadPublicConfig } from '../services/configService';
import './BankingAgent.css';

// ─── Action definitions ────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'accounts',     label: '🏦 My Accounts',       desc: 'List all your accounts' },
  { id: 'transactions', label: '📋 Recent Transactions', desc: 'View recent activity' },
  { id: 'balance',      label: '💰 Check Balance',      desc: 'Balance for an account' },
  { id: 'deposit',      label: '⬇ Deposit',             desc: 'Deposit into an account' },
  { id: 'withdraw',     label: '⬆ Withdraw',            desc: 'Withdraw from an account' },
  { id: 'transfer',     label: '↔ Transfer',            desc: 'Transfer between accounts' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n) {
  return typeof n === 'number'
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : n;
}

function formatResult(result) {
  if (!result) return 'No data returned.';
  // Accounts list
  if (result.accounts) {
    return result.accounts.map(a =>
      `${a.account_type || a.type || 'Account'}: ${a.account_number || a.id}\n  Balance: ${formatCurrency(a.balance)}`
    ).join('\n\n');
  }
  // Transactions list
  if (result.transactions) {
    return result.transactions.slice(0, 10).map(t =>
      `${t.type}: ${formatCurrency(t.amount)} — ${t.description || ''}\n  ${new Date(t.created_at || t.createdAt).toLocaleDateString()}`
    ).join('\n\n');
  }
  // Balance response
  if (result.balance !== undefined) {
    return `Balance: ${formatCurrency(result.balance)}`;
  }
  // Transaction confirmation
  if (result.transaction_id || result.transactionId || result.id) {
    return `✅ Success\nTransaction ID: ${result.transaction_id || result.transactionId || result.id}\nAmount: ${formatCurrency(result.amount)}`;
  }
  return JSON.stringify(result, null, 2);
}

// ─── Input form for actions that need parameters ──────────────────────────────

function ActionForm({ action, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fields = {
    balance:  [{ key: 'accountId', label: 'Account ID', placeholder: 'e.g. acc_abc123' }],
    deposit:  [
      { key: 'accountId', label: 'Account ID', placeholder: 'e.g. acc_abc123' },
      { key: 'amount',    label: 'Amount ($)',  placeholder: '0.00', type: 'number' },
      { key: 'note',      label: 'Note',        placeholder: 'optional' },
    ],
    withdraw: [
      { key: 'accountId', label: 'Account ID', placeholder: 'e.g. acc_abc123' },
      { key: 'amount',    label: 'Amount ($)',  placeholder: '0.00', type: 'number' },
      { key: 'note',      label: 'Note',        placeholder: 'optional' },
    ],
    transfer: [
      { key: 'fromId',    label: 'From Account ID', placeholder: 'e.g. acc_abc123' },
      { key: 'toId',      label: 'To Account ID',   placeholder: 'e.g. acc_def456' },
      { key: 'amount',    label: 'Amount ($)',        placeholder: '0.00', type: 'number' },
      { key: 'note',      label: 'Note',              placeholder: 'optional' },
    ],
  };

  return (
    <div className="banking-agent-form">
      {(fields[action] || []).map(f => (
        <div key={f.key} className="banking-agent-field">
          <label>{f.label}</label>
          <input
            type={f.type || 'text'}
            placeholder={f.placeholder}
            value={form[f.key] || ''}
            onChange={e => set(f.key, e.target.value)}
          />
        </div>
      ))}
      <div className="banking-agent-form-actions">
        <button className="banking-agent-btn-primary" disabled={loading} onClick={() => onSubmit(form)}>
          {loading ? '…' : 'Run'}
        </button>
        <button className="banking-agent-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

// ─── Login actions (shown when not authenticated) ────────────────────────────

const LOGIN_ACTIONS = [
  { id: 'login_admin', label: '👑 Admin Login',    desc: 'Sign in as an administrator' },
  { id: 'login_user',  label: '👤 Customer Login', desc: 'Sign in as a bank customer' },
];

function handleLoginAction(actionId) {
  const apiUrl = process.env.REACT_APP_API_URL || window.location.origin;
  if (actionId === 'login_admin') {
    window.location.href = `${apiUrl}/api/auth/oauth/login`;
  } else {
    window.location.href = `${apiUrl}/api/auth/oauth/user/login`;
  }
}

export default function BankingAgent({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  /** null = loading; which OAuth flows have client IDs + environment */
  const [oauthConfig, setOauthConfig] = useState(null);
  const bottomRef = useRef(null);
  const navigate = useNavigate();

  const isLoggedIn = !!user;
  const isConfigured = oauthConfig && (oauthConfig.admin || oauthConfig.user);

  // Check config status from IndexedDB cache whenever panel opens
  useEffect(() => {
    if (isOpen && !isLoggedIn) {
      loadPublicConfig()
        .then(cfg => {
          const env = !!cfg.pingone_environment_id;
          setOauthConfig({
            admin: env && !!cfg.admin_client_id,
            user: env && !!cfg.user_client_id,
          });
        })
        .catch(() => setOauthConfig({ admin: false, user: false }));
    }
  }, [isOpen, isLoggedIn]);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  function addMessage(role, content, tool) {
    setMessages(prev => [...prev, { id: Date.now().toString(), role, content, tool }]);
  }

  async function runAction(actionId, form) {
    setActiveAction(null);
    const label = ACTIONS.find(a => a.id === actionId)?.label || actionId;
    addMessage('user', label);
    setLoading(true);

    try {
      let result;
      switch (actionId) {
        case 'accounts':
          result = await getMyAccounts();
          break;
        case 'transactions':
          result = await getMyTransactions();
          break;
        case 'balance':
          result = await getAccountBalance(form.accountId);
          break;
        case 'deposit':
          result = await createDeposit(form.accountId, parseFloat(form.amount), form.note);
          break;
        case 'withdraw':
          result = await createWithdrawal(form.accountId, parseFloat(form.amount), form.note);
          break;
        case 'transfer':
          result = await createTransfer(form.fromId, form.toId, parseFloat(form.amount), form.note);
          break;
        default:
          throw new Error(`Unknown action: ${actionId}`);
      }
      addMessage('assistant', formatResult(result), actionId);
    } catch (err) {
      const isConnErr =
        err.message.includes('timed out') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ENETUNREACH') ||
        err.message.includes('mcp_error') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('502');
      addMessage(
        'error',
        isConnErr
          ? 'Banking Agent is unavailable.\n\nThe MCP server is not reachable.\n\nLocal: cd banking_mcp_server && npm run dev\nVercel: set MCP_SERVER_URL to your hosted MCP server URL.'
          : `Error: ${err.message}`,
        actionId
      );
    } finally {
      setLoading(false);
    }
  }

  function handleActionClick(actionId) {
    // No form needed for read-only queries
    if (actionId === 'accounts' || actionId === 'transactions') {
      runAction(actionId, {});
    } else {
      setActiveAction(actionId);
    }
  }

  return (
    <>
      {/* FAB */}
      <button
        className={`banking-agent-fab ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(v => !v)}
        aria-label={isOpen ? 'Close agent panel' : 'Open banking agent'}
        title="Banking MCP Agent"
      >
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="banking-agent-panel" role="dialog" aria-label="Banking MCP Agent">
          {/* Header */}
          <div className="banking-agent-header">
            <div className="banking-agent-header-info">
              <span className="banking-agent-avatar">🏦</span>
              <div>
                <div className="banking-agent-title">PingOne AI Core</div>
                <div className="banking-agent-subtitle">
                  {isLoggedIn ? `Powered by MCP · ${user.name?.split(' ')[0] || 'Secure'}` : 'How can I help you today?'}
                </div>
              </div>
            </div>
            <button className="banking-agent-close-btn" onClick={() => setIsOpen(false)} aria-label="Close">✕</button>
          </div>

          {/* Messages */}
          <div className="banking-agent-messages">
            {messages.length === 0 && (
              <div className="banking-agent-welcome">
                <p>
                  {isLoggedIn
                    ? 'Select an action below. Calls go from this app to the Banking API; the MCP server runs banking tools and talks to the same API with scoped tokens.'
                    : oauthConfig === null
                      ? 'Welcome to PingOne AI Core. Checking configuration…'
                      : isConfigured
                        ? 'PingOne AI Core is configured. Sign in to get started.'
                        : 'Set up your PingOne credentials to get started.'}
                </p>
                <details className="banking-agent-learn">
                  <summary>How OAuth, API &amp; MCP work together</summary>
                  <ol>
                    <li><strong>Sign in</strong> — Your browser follows PingOne OAuth (PKCE). Tokens are created at PingOne and stored in the Banking API session, not in localStorage.</li>
                    <li><strong>REST calls</strong> — Buttons below use <code>/api/…</code> routes; the server uses your session to know who you are.</li>
                    <li><strong>MCP</strong> — The MCP server exposes tools (accounts, transfers). The Banking API can call it via WebSocket; tools may use a delegated token (RFC 8693 exchange) scoped for the MCP audience.</li>
                    <li><strong>Token exchange</strong> — Before each MCP hop, the BFF may call PingOne <code>POST /as/token</code> with <code>grant_type=token-exchange</code> (subject token from your session; optional actor token for &quot;on behalf of&quot;). See <strong>CIBA guide → Token exchange</strong> for before/after, HTTP status, and JSON responses.</li>
                    <li><strong>CIBA</strong> — Optional push approval without a full redirect (see the <strong>CIBA guide</strong> button).</li>
                  </ol>
                  <p className="banking-agent-learn-hint">Open <strong>CIBA guide → Full stack</strong> for the diagram; <strong>Token exchange</strong> for RFC 8693 details; <strong>Application Configuration</strong> has an MCP Inspector setup wizard.</p>
                </details>
                <details className="banking-agent-learn">
                  <summary>Admin login vs Customer login vs this Agent</summary>
                  <p className="banking-agent-learn-hint" style={{ marginTop: '0.5rem' }}>
                    <strong>Admin</strong> and <strong>Customer</strong> on the login page are two different PingOne OAuth apps. Admin goes to <code>/admin</code> (tenant-wide tools). Customer goes to <code>/dashboard</code> (personal accounts).
                  </p>
                  <p className="banking-agent-learn-hint">
                    <strong>This panel</strong> is not a separate login. After you sign in, actions here call <code>POST /api/mcp/tool</code> using <strong>your current session</strong> — same identity as the rest of the app. We know who you are from the server session cookie, not from a different &quot;agent user.&quot;
                  </p>
                  <p className="banking-agent-learn-hint">Full comparison: <strong>CIBA guide → Sign-in &amp; roles</strong>.</p>
                </details>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`banking-agent-msg ${msg.role}`}>
                {msg.role === 'assistant' && <span className="banking-agent-msg-avatar">🏦</span>}
                <div className="banking-agent-msg-bubble">
                  <pre className="banking-agent-msg-text">{msg.content}</pre>
                  {msg.tool && <span className="banking-agent-tool-badge">⚙ {msg.tool}</span>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="banking-agent-msg assistant typing">
                <span className="banking-agent-msg-avatar">🏦</span>
                <div className="banking-agent-msg-bubble">
                  <span className="banking-agent-dots"><span /><span /><span /></span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Action form (when user selects a transaction action) */}
          {activeAction && (
            <ActionForm
              action={activeAction}
              loading={loading}
              onSubmit={form => runAction(activeAction, form)}
              onCancel={() => setActiveAction(null)}
            />
          )}

          {/* Action buttons */}
          {!activeAction && (
            <div className="banking-agent-actions">
              {isLoggedIn
                ? ACTIONS.map(a => (
                    <button
                      key={a.id}
                      className="banking-agent-action-btn"
                      onClick={() => handleActionClick(a.id)}
                      disabled={loading}
                      title={a.desc}
                    >
                      {a.label}
                    </button>
                  ))
                : (
                    <>
                      {/* Configure step */}
                      <button
                        className={`banking-agent-action-btn banking-agent-config-btn${isConfigured ? ' banking-agent-config-done' : ''}`}
                        onClick={() => { setIsOpen(false); navigate('/config'); }}
                        title="Open PingOne configuration settings"
                      >
                        {isConfigured ? '✅ Configured' : '⚙️ Configure PingOne'}
                      </button>

                      {/* Next-step hint + login buttons */}
                      {isConfigured && (
                        <div className="banking-agent-next-step">
                          <span className="banking-agent-next-label">Next → Sign in</span>
                        </div>
                      )}
                      {LOGIN_ACTIONS.map(a => {
                        const canAdmin = oauthConfig?.admin;
                        const canUser = oauthConfig?.user;
                        const canUse =
                          a.id === 'login_admin' ? canAdmin : canUser;
                        return (
                          <button
                            key={a.id}
                            className={`banking-agent-action-btn banking-agent-login-btn${isConfigured ? ' banking-agent-login-ready' : ''}`}
                            onClick={() => handleLoginAction(a.id)}
                            title={
                              oauthConfig === null
                                ? a.desc
                                : canUse
                                  ? a.desc
                                  : a.id === 'login_admin'
                                    ? 'Configure admin client ID in Settings'
                                    : 'Configure end-user client ID in Settings'
                            }
                            disabled={oauthConfig === null || !canUse}
                          >
                            {a.label}
                          </button>
                        );
                      })}
                    </>
                  )
              }
              {isLoggedIn && (
                <button
                  className="banking-agent-action-btn banking-agent-config-btn"
                  onClick={() => { setIsOpen(false); navigate('/config'); }}
                  title="Open PingOne configuration settings"
                >
                  ⚙️ Configure
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

