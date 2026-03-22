// banking_api_server/services/vercelPublicUrl.js
/**
 * Canonical HTTPS origin for the public app (no trailing slash).
 * OAuth redirect_uri values sent to PingOne must match an exact entry in the app’s Redirect URI list;
 * Vercel preview/deployment hostnames change per deploy, so we must not rely on req.get('host') alone.
 *
 * Resolution order:
 *   1. PUBLIC_APP_URL — optional server-only override (e.g. https://banking-demo-puce.vercel.app)
 *   2. REACT_APP_CLIENT_URL — same value you set for the CRA build (Vercel exposes it to the API runtime)
 *   3. VERCEL_PROJECT_PRODUCTION_URL — Vercel system variable: stable production hostname (enable in project settings)
 */
'use strict';

function stripTrailingSlash(s) {
  return (s || '').trim().replace(/\/+$/, '');
}

function getCanonicalPublicOrigin() {
  const explicit = stripTrailingSlash(process.env.PUBLIC_APP_URL || process.env.REACT_APP_CLIENT_URL);
  if (explicit) return explicit;

  const prodHost = stripTrailingSlash(process.env.VERCEL_PROJECT_PRODUCTION_URL || '');
  if (prodHost) {
    const host = prodHost.replace(/^https?:\/\//i, '');
    return `https://${host}`;
  }

  return null;
}

module.exports = { getCanonicalPublicOrigin };
