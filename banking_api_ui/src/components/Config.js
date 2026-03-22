import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { savePublicConfig, loadPublicConfig } from '../services/configService';

// ─── Region options ───────────────────────────────────────────────────────────
const REGION_OPTIONS = [
  { value: 'com',    label: 'North America (com)' },
  { value: 'eu',     label: 'Europe (eu)' },
  { value: 'ca',     label: 'Canada (ca)' },
  { value: 'asia',   label: 'Asia-Pacific (asia)' },
  { value: 'com.au', label: 'Australia (com.au)' },
];

// ─── Empty form state ─────────────────────────────────────────────────────────
const EMPTY_FORM = {
  pingone_environment_id: '',
  pingone_region: 'com',
  admin_client_id: '',
  admin_client_secret: '',
  admin_redirect_uri: '',
  user_client_id: '',
  user_client_secret: '',
  user_redirect_uri: '',
  admin_role: 'admin',
  user_role: 'customer',
  session_secret: '',
  frontend_url: '',
  mcp_server_url: '',           // populated from saved config; not defaulted to localhost
  debug_oauth: 'false',
  // PingOne Authorize
  authorize_enabled: 'false',
  authorize_policy_id: '',
  authorize_worker_client_id: '',
  authorize_worker_client_secret: '',
};

// ─── Helper: secret field wrapper ────────────────────────────────────────────
function SecretField({ label, fieldKey, value, isSet, showValue, onToggleShow, onChange, help, disabled }) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label}
        {isSet && (
          <span style={{
            marginLeft: '0.5rem',
            fontSize: '0.7rem',
            background: '#d1fae5',
            color: '#065f46',
            padding: '0.1rem 0.4rem',
            borderRadius: '999px',
            fontWeight: 600,
          }}>✓ already set</span>
        )}
      </label>
      <div style={{ position: 'relative', display: 'flex', gap: '0.5rem' }}>
        <input
          type={showValue ? 'text' : 'password'}
          className="form-input"
          value={value}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          placeholder={isSet ? 'Leave blank to keep current value' : 'Enter value…'}
          autoComplete="off"
          style={{ flex: 1 }}
          disabled={disabled}
          readOnly={disabled}
        />
        <button
          type="button"
          onClick={() => onToggleShow(fieldKey)}
          title={showValue ? 'Hide' : 'Show'}
          disabled={disabled}
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            background: 'white',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: '1rem',
            lineHeight: 1,
          }}
        >
          {showValue ? '🙈' : '👁️'}
        </button>
      </div>
      {help && <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>{help}</p>}
    </div>
  );
}

// ─── Helper: public text field ────────────────────────────────────────────────
function TextField({ label, fieldKey, value, onChange, help, placeholder, type = 'text', disabled }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        type={type}
        className="form-input"
        value={value}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        placeholder={placeholder || ''}
        disabled={disabled}
        readOnly={disabled}
      />
      {help && <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>{help}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Config() {
  const [form, setForm]               = useState(EMPTY_FORM);
  const [secretMeta, setSecretMeta]   = useState({});   // { <key>_set: bool }
  const [showSecret, setShowSecret]   = useState({});   // { key: bool }
  const [storageType, setStorageType] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [readOnly, setReadOnly]       = useState(false);

  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [testing, setTesting]     = useState(false);

  const [testResult, setTestResult] = useState(null);
  // Admin password for Vercel (since serverless sessions don't persist)
  const [configPassword, setConfigPassword] = useState('');  // matches ADMIN_CONFIG_PASSWORD env var

  // ── Fetch from server + merge with IndexedDB cache ──
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      // Load IndexedDB cache first for instant pre-fill
      const cached = await loadPublicConfig();
      if (Object.keys(cached).length > 0) {
        setForm((prev) => ({ ...prev, ...cached }));
      }

      // Then fetch from server (authoritative source)
      const { data } = await axios.get('/api/admin/config');
      const cfg = data.config || {};
      const meta = {};

      const formUpdates = {};
      for (const key of Object.keys(EMPTY_FORM)) {
        if (key.endsWith('_set')) continue;
        // Server returns '••••••••' for set secrets and '' for unset ones
        const isSecret = ['admin_client_secret', 'user_client_secret', 'session_secret'].includes(key);
        if (isSecret) {
          meta[`${key}_set`] = !!cfg[`${key}_set`];
          // Don't populate the form field for secrets (show placeholder "already set")
          formUpdates[key] = '';
        } else {
          formUpdates[key] = cfg[key] || EMPTY_FORM[key];
        }
      }

      setForm((prev) => ({ ...prev, ...formUpdates }));
      setSecretMeta(meta);
      setStorageType(data.storageType || '');
      setIsConfigured(data.isConfigured || false);
      setReadOnly(data.readOnly || false);

      // Persist public values back to IndexedDB
      await savePublicConfig(formUpdates);
    } catch (err) {
      showToast('error', `Could not load config: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Auto-fill redirect URIs from current origin if empty
  useEffect(() => {
    const origin = window.location.origin;
    setForm((prev) => ({
      ...prev,
      admin_redirect_uri: prev.admin_redirect_uri || `${origin}/api/auth/oauth/callback`,
      user_redirect_uri:  prev.user_redirect_uri  || `${origin}/api/auth/oauth/user/callback`,
      frontend_url:       prev.frontend_url       || origin,
    }));
  }, []);

  // ── Field helpers ──
  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleShow = (key) => {
    setShowSecret((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  function showToast(type, msg) {
    if (type === 'success') toast.success(msg);
    else toast.error(msg);
  }

  // Build auth headers for config write requests (Vercel: password header)
  const getConfigHeaders = () => {
    if (storageType === 'vercel-kv' && configPassword) {
      return { 'X-Config-Password': configPassword };
    }
    return {};
  };

  // ── Save ──
  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await axios.post('/api/admin/config', form, { headers: getConfigHeaders() });
      setIsConfigured(data.isConfigured);

      // Update secret meta from response
      const meta = {};
      for (const key of ['admin_client_secret', 'user_client_secret', 'session_secret']) {
        meta[`${key}_set`] = !!data.config?.[`${key}_set`];
      }
      setSecretMeta(meta);

      // Clear secret form fields after save (they're stored, don't show them)
      setForm((prev) => ({
        ...prev,
        admin_client_secret: '',
        user_client_secret: '',
        session_secret: '',
      }));

      // Persist public fields to IndexedDB
      await savePublicConfig(form);

      showToast('success', 'Configuration saved successfully!');
    } catch (err) {
      showToast('error', `Save failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Test connection ──
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Send the current form values so the test works before saving
      const { data } = await axios.post('/api/admin/config/test', {
        pingone_environment_id: form.pingone_environment_id,
        pingone_region:         form.pingone_region,
        admin_client_id:        form.admin_client_id,
      }, { headers: getConfigHeaders() });
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setTesting(false);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Page header */}
      <div style={{
        background: 'linear-gradient(to bottom, #1e40af 0%, #1e3a8a 100%)',
        color: 'white',
        padding: '1rem 0',
        boxShadow: '0 2px 4px rgba(0,0,0,.15)',
      }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>⚙️ Application Configuration</h1>
            <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.25rem' }}>
              PingOne OAuth settings — stored in {storageType === 'vercel-kv' ? 'Vercel KV (cloud)' : 'SQLite (local)'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {isConfigured && (
              <span style={{ fontSize: '0.75rem', background: '#d1fae5', color: '#065f46', padding: '0.25rem 0.75rem', borderRadius: '999px', fontWeight: 600 }}>
                ✓ Configured
              </span>
            )}
            {!isConfigured && (
              <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#92400e', padding: '0.25rem 0.75rem', borderRadius: '999px', fontWeight: 600 }}>
                ⚠ Not configured
              </span>
            )}
            <a href="/" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem', textDecoration: 'none' }}>← Back to app</a>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: '2rem 20px', maxWidth: '800px' }}>

        {/* Read-only banner (Vercel deployment) */}
        {readOnly && (
          <div style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '0.5rem',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            color: '#1e40af',
          }}>
            <strong>Read-only mode:</strong> This server has no KV database attached, so settings must come from environment variables (or connect Vercel KV / Upstash and redeploy). Local development without this restriction uses SQLite and can save here.
          </div>
        )}

        {/* First-run banner */}
        {!isConfigured && !readOnly && (
          <div style={{
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: '0.5rem',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            color: '#9a3412',
          }}>
            <strong>First-time setup:</strong> Fill in your PingOne credentials below and click <strong>Save Configuration</strong>.
            Settings are persisted in {storageType === 'vercel-kv' ? 'Vercel KV' : 'SQLite'} so they survive server restarts.
          </div>
        )}

        <form onSubmit={handleSave}>

          {/* ── Section 1: PingOne Environment ── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">PingOne Environment</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <TextField
                  label="Environment ID"
                  fieldKey="pingone_environment_id"
                  value={form.pingone_environment_id}
                  onChange={handleChange}
                  placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                  help="Found in PingOne → Environments → (your env) → Settings → Environment ID"
                  disabled={readOnly}
                />
              </div>
              <div>
                <label className="form-label">Region</label>
                <select
                  className="form-input"
                  value={form.pingone_region}
                  onChange={(e) => handleChange('pingone_region', e.target.value)}
                  disabled={readOnly}
                >
                  {REGION_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <TextField
                  label="Frontend URL"
                  fieldKey="frontend_url"
                  value={form.frontend_url}
                  onChange={handleChange}
                  placeholder={window.location.origin}
                  help="The URL your React app is served from"
                  disabled={readOnly}
                />
              </div>
            </div>

            {/* Test connection */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTest}
                disabled={testing || !form.pingone_environment_id}
              >
                {testing ? 'Testing…' : '🔌 Test PingOne Connection'}
              </button>
              {testResult && (
                <div style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  background: testResult.ok ? '#d1fae5' : '#fee2e2',
                  color: testResult.ok ? '#065f46' : '#7f1d1d',
                  fontSize: '0.875rem',
                  flex: 1,
                }}>
                  {testResult.ok ? `✓ ${testResult.message}` : `✗ ${testResult.message}`}
                  {testResult.ok && testResult.issuer && (
                    <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.2rem' }}>
                      Issuer: {testResult.issuer}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Section 2: Admin OAuth App ── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Admin OAuth App</h2>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Authorization Code + PKCE · admin users</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <TextField
                label="Client ID"
                fieldKey="admin_client_id"
                value={form.admin_client_id}
                onChange={handleChange}
                placeholder="Admin app client ID"
                disabled={readOnly}
              />
              <div /> {/* spacer */}
              <div style={{ gridColumn: '1 / -1' }}>
                <SecretField
                  label="Client Secret"
                  fieldKey="admin_client_secret"
                  value={form.admin_client_secret}
                  isSet={!!secretMeta.admin_client_secret_set}
                  showValue={!!showSecret.admin_client_secret}
                  onToggleShow={toggleShow}
                  onChange={handleChange}
                  help="Leave blank to keep the existing secret stored on the server"
                  disabled={readOnly}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <TextField
                  label="Redirect URI (must match PingOne app settings)"
                  fieldKey="admin_redirect_uri"
                  value={form.admin_redirect_uri}
                  onChange={handleChange}
                  placeholder={`${window.location.origin}/api/auth/oauth/callback`}
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>

          {/* ── Section 3: End-User OAuth App ── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">End-User OAuth App</h2>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Authorization Code + PKCE · banking customers</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <TextField
                label="Client ID"
                fieldKey="user_client_id"
                value={form.user_client_id}
                onChange={handleChange}
                placeholder="End-user app client ID"
                disabled={readOnly}
              />
              <div />
              <div style={{ gridColumn: '1 / -1' }}>
                <SecretField
                  label="Client Secret"
                  fieldKey="user_client_secret"
                  value={form.user_client_secret}
                  isSet={!!secretMeta.user_client_secret_set}
                  showValue={!!showSecret.user_client_secret}
                  onToggleShow={toggleShow}
                  onChange={handleChange}
                  help="Leave blank to keep the existing secret stored on the server"
                  disabled={readOnly}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <TextField
                  label="Redirect URI (must match PingOne app settings)"
                  fieldKey="user_redirect_uri"
                  value={form.user_redirect_uri}
                  onChange={handleChange}
                  placeholder={`${window.location.origin}/api/auth/oauth/user/callback`}
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>

          {/* ── Section 4: Session & Roles ── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Session & Roles</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <TextField
                label="Admin Role name (in PingOne)"
                fieldKey="admin_role"
                value={form.admin_role}
                onChange={handleChange}
                placeholder="admin"
                disabled={readOnly}
              />
              <TextField
                label="Customer Role name (in PingOne)"
                fieldKey="user_role"
                value={form.user_role}
                onChange={handleChange}
                placeholder="customer"
                disabled={readOnly}
              />
              <div style={{ gridColumn: '1 / -1' }}>
                <SecretField
                  label="Session Secret"
                  fieldKey="session_secret"
                  value={form.session_secret}
                  isSet={!!secretMeta.session_secret_set}
                  showValue={!!showSecret.session_secret}
                  onToggleShow={toggleShow}
                  onChange={handleChange}
                  help="Random string used to sign session cookies — use at least 32 characters"
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>

          {/* ── Section 5: PingOne Authorize ── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">PingOne Authorize</h2>
              <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
                Policy-based authorization for transfers and withdrawals. Requires a Worker app
                with the <strong>Identity Data Admin</strong> role and a configured Policy Decision Point.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Enable PingOne Authorize</label>
                <select
                  className="form-input"
                  value={form.authorize_enabled}
                  onChange={(e) => handleChange('authorize_enabled', e.target.value)}
                  disabled={readOnly}
                >
                  <option value="false">Disabled</option>
                  <option value="true">Enabled — enforce on transfers &amp; withdrawals</option>
                </select>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  When enabled, every transfer and withdrawal is evaluated against the policy below.
                </p>
              </div>
              <TextField
                label="Policy Decision Point ID"
                fieldKey="authorize_policy_id"
                value={form.authorize_policy_id}
                onChange={handleChange}
                placeholder="e.g. abc12345-…"
                help="The PDP ID from PingOne Authorize → Policy Decision Points."
                disabled={readOnly}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
              <TextField
                label="Worker App Client ID"
                fieldKey="authorize_worker_client_id"
                value={form.authorize_worker_client_id}
                onChange={handleChange}
                placeholder="Worker app client ID"
                help="Client ID of the Worker application used to obtain tokens for policy evaluation."
                disabled={readOnly}
              />
              <SecretField
                label="Worker App Client Secret"
                fieldKey="authorize_worker_client_secret"
                value={form.authorize_worker_client_secret}
                isSet={secretMeta.authorize_worker_client_secret_set}
                showValue={!!showSecret.authorize_worker_client_secret}
                onToggleShow={toggleShow}
                onChange={handleChange}
                help="Client secret for the Worker app. Stored encrypted at rest."
                disabled={readOnly}
              />
            </div>
          </div>

          {/* ── Section 6: Advanced ── */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Advanced</h2>
            </div>

            {/* Vercel warning: LangChain agent is local-only */}
            {storageType === 'vercel-kv' && (
              <div style={{
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                borderRadius: '0.5rem',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'flex-start',
                fontSize: '0.875rem',
                color: '#92400e',
              }}>
                <span style={{ fontSize: '1rem', lineHeight: 1 }}>⚠️</span>
                <div>
                  <strong>LangChain / MCP Agent not available on Vercel.</strong> The agent runs
                  as a local Python process and cannot be reached from a Vercel deployment.
                  Leave this field blank — the chat panel will show a "not configured" message
                  instead of failing silently.
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <TextField
                label="LangChain / MCP Agent URL"
                fieldKey="mcp_server_url"
                value={form.mcp_server_url}
                onChange={handleChange}
                placeholder={storageType === 'vercel-kv' ? 'Not available on Vercel — leave blank' : 'http://localhost:8000'}
                help={storageType === 'vercel-kv'
                  ? '⚠️ This URL is only reachable when running locally. On Vercel, clear this field.'
                  : 'URL of the banking LangChain agent (WebSocket). Local only — not available on Vercel.'}
                disabled={readOnly}
              />
              <div>
                <label className="form-label">Debug OAuth logging</label>
                <select
                  className="form-input"
                  value={form.debug_oauth}
                  onChange={(e) => handleChange('debug_oauth', e.target.value)}
                  disabled={readOnly}
                >
                  <option value="false">Off</option>
                  <option value="true">On (verbose)</option>
                </select>
              </div>
            </div>

            {/* Vercel: admin password required to save once config is set — hidden in read-only mode */}
            {storageType === 'vercel-kv' && !readOnly && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
                <div style={{
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  borderRadius: '0.5rem',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.75rem',
                  fontSize: '0.8125rem',
                  color: '#6b21a8',
                }}>
                  <strong>🔑 Vercel Config Password</strong> — once credentials are saved, updates require
                  an admin password. Set <code>ADMIN_CONFIG_PASSWORD</code> in your Vercel environment
                  variables, then enter it here before saving. Leave blank on first-time setup.
                </div>
                <div className="form-group" style={{ maxWidth: '400px' }}>
                  <label className="form-label">Config Password (Vercel only)</label>
                  <input
                    type="password"
                    className="form-input"
                    value={configPassword}
                    onChange={(e) => setConfigPassword(e.target.value)}
                    placeholder="Value of ADMIN_CONFIG_PASSWORD env var"
                  />
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    Required to overwrite config on Vercel. Not stored — enter each session.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Save button — hidden in read-only mode ── */}
          {!readOnly && (
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem', marginBottom: '2rem' }}>
            <button type="button" className="btn btn-secondary" onClick={loadConfig}>
              ↺ Reload from server
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Configuration'}
            </button>
          </div>
          )}

        </form>
      </div>
    </div>
  );
}
