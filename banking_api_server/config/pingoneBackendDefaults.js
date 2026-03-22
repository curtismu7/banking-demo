'use strict';

/**
 * Optional baked-in PingOne **public** identifiers (no secrets).
 *
 * Use this file to pin the hosted app to a specific tenant without asking
 * end users to configure OAuth in the UI. Client **secrets** must never be
 * committed — supply them via deployment secrets (Vercel) or KV/SQLite.
 *
 * Leave values empty ('') to fall back to environment variables / Config UI / KV.
 *
 * @type {Record<string, string>}
 */
module.exports = {
  pingone_environment_id: '',
  admin_client_id: '',
  user_client_id: '',
  /** Optional; redirect URIs are normally derived from the public app URL. */
  admin_redirect_uri: '',
  user_redirect_uri: '',
  frontend_url: '',
};
