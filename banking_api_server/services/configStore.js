/**
 * ConfigStore — persists app configuration across server/browser restarts.
 *
 * Local (no KV_REST_API_URL):  SQLite via better-sqlite3  →  data/config.db
 * Vercel (KV_REST_API_URL set): @vercel/kv (Upstash Redis) →  banking:config hash
 *
 * Secrets (clientSecret, sessionSecret) are encrypted with AES-256-GCM before
 * being written to storage, using a key derived from CONFIG_ENCRYPTION_KEY or
 * SESSION_SECRET.  The in-memory cache always holds plaintext values.
 *
 * The exported singleton exposes:
 *   configStore.get(key)              → sync read from in-memory cache
 *   await configStore.setConfig(data) → validate + save + update cache
 *   configStore.getMasked()           → safe subset for sending to the browser
 *   await configStore.ensureInitialized() → call once before handling requests
 */

'use strict';

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Vercel KV (managed) OR direct Upstash (via marketplace integration)
const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN  || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_KV   = !!(KV_URL && KV_TOKEN);
const KV_HASH_KEY = 'banking:config';

// Fields that must be encrypted at rest
const SECRET_KEYS = new Set(['admin_client_secret', 'user_client_secret', 'session_secret', 'authorize_worker_client_secret']);

// All known config keys with their defaults and whether they are public
const FIELD_DEFS = {
  // PingOne environment
  pingone_environment_id: { public: true,  default: '' },
  pingone_region:         { public: true,  default: 'com' },

  // Admin OAuth app
  admin_client_id:        { public: true,  default: '' },
  admin_client_secret:    { public: false, default: '' },
  admin_redirect_uri:     { public: true,  default: '' },

  // End-user OAuth app
  user_client_id:         { public: true,  default: '' },
  user_client_secret:     { public: false, default: '' },
  user_redirect_uri:      { public: true,  default: '' },

  // Auth server
  admin_role:             { public: true,  default: 'admin' },
  user_role:              { public: true,  default: 'customer' },

  // Server / misc
  session_secret:         { public: false, default: '' },
  frontend_url:           { public: true,  default: '' },
  mcp_server_url:         { public: true,  default: 'http://localhost:8000' },
  debug_oauth:            { public: true,  default: 'false' },

  // PingOne Authorize (policy decision point for transfers/withdrawals)
  authorize_enabled:              { public: true,  default: 'false' },
  authorize_policy_id:            { public: true,  default: '' },
  authorize_worker_client_id:     { public: true,  default: '' },
  authorize_worker_client_secret: { public: false, default: '' },
};

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function _getEncryptionKey() {
  const rawKey = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-fallback-key-do-not-use-in-production';
  // Derive a stable 32-byte key using scrypt with a fixed salt
  return crypto.scryptSync(rawKey, 'banking-config-salt-v1', 32);
}

function _encrypt(plaintext) {
  try {
    const key = _getEncryptionKey();
    const iv  = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  } catch (err) {
    throw new Error(`Config encryption failed: ${err.message}`);
  }
}

function _decrypt(ciphertext) {
  try {
    const key  = _getEncryptionKey();
    const data = Buffer.from(ciphertext, 'base64');
    const iv   = data.subarray(0, 12);
    const tag  = data.subarray(12, 28);
    const enc  = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (_) {
    // Corrupted or mis-keyed — return empty so the field shows as "not set"
    return '';
  }
}

// ---------------------------------------------------------------------------
// SQLite helpers (local only)
// ---------------------------------------------------------------------------

let _sqliteDB = null;

function _getSQLite() {
  if (_sqliteDB) return _sqliteDB;
  const Database = require('better-sqlite3');
  const dbDir  = path.join(__dirname, '..', 'data', 'persistent');
  const dbPath = path.join(dbDir, 'config.db');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  _sqliteDB = db;
  return db;
}

// ---------------------------------------------------------------------------
// ConfigStore class
// ---------------------------------------------------------------------------

class ConfigStore {
  constructor() {
    /** @type {Record<string, string>} plaintext in-memory cache */
    this._cache = {};
    this._initPromise = null;
  }

  /**
   * Ensure the store is loaded before use.
   * Safe to call multiple times — only initialises once.
   */
  ensureInitialized() {
    if (!this._initPromise) {
      this._initPromise = this._initialize().catch((err) => {
        console.error('[ConfigStore] initialization error:', err.message);
        this._initPromise = null; // allow retry
      });
    }
    return this._initPromise;
  }

  async _initialize() {
    if (USE_KV) {
      await this._loadFromKV();
    } else {
      this._loadFromSQLite();
    }
  }

  _loadFromSQLite() {
    const db   = _getSQLite();
    const rows = db.prepare('SELECT key, value FROM config').all();
    for (const row of rows) {
      this._cache[row.key] = SECRET_KEYS.has(row.key) ? _decrypt(row.value) : row.value;
    }
  }

  async _loadFromKV() {
    const { createClient } = require('@vercel/kv');
    const kv = createClient({ url: KV_URL, token: KV_TOKEN });
    const data = await kv.hgetall(KV_HASH_KEY);
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        this._cache[key] = SECRET_KEYS.has(key) ? _decrypt(value) : value;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Synchronous cache lookup.  Returns null if not set.
   * Always call ensureInitialized() before the first get().
   */
  get(key) {
    const v = this._cache[key];
    return (v !== undefined && v !== '') ? v : null;
  }

  /**
   * Persist new configuration values.
   * Accepts partial updates — only sets keys that are provided and non-empty.
   * Secrets are encrypted before writing to storage.
   */
  async setConfig(data) {
    await this.ensureInitialized();

    const updates = {};        // what goes into storage (encrypted secrets)
    const cacheUpdates = {};   // what goes into the in-memory cache (plaintext)

    for (const [key, value] of Object.entries(data)) {
      if (!(key in FIELD_DEFS)) continue;          // ignore unknown keys
      if (value === null || value === undefined || value === '') continue;
      // Value is a non-empty string
      const stored = SECRET_KEYS.has(key) ? _encrypt(value) : value;
      updates[key]      = stored;
      cacheUpdates[key] = value;
    }

    if (Object.keys(updates).length === 0) return;

    if (USE_KV) {
      const { createClient } = require('@vercel/kv');
      const kv = createClient({ url: KV_URL, token: KV_TOKEN });
      await kv.hset(KV_HASH_KEY, updates);
    } else {
      const db = _getSQLite();
      const upsert = db.prepare(
        'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)'
      );
      const now = new Date().toISOString();
      db.transaction(() => {
        for (const [key, value] of Object.entries(updates)) {
          upsert.run(key, value, now);
        }
      })();
    }

    // Update cache last, so failures above leave cache consistent
    Object.assign(this._cache, cacheUpdates);
  }

  /**
   * Returns the full stored config with secrets replaced by '••••••••'.
   * Also includes a `<key>_set` boolean for each secret field.
   * Public fields are returned as-is.
   */
  getMasked() {
    const result = {};
    for (const key of Object.keys(FIELD_DEFS)) {
      if (SECRET_KEYS.has(key)) {
        const isSet = !!(this._cache[key]);
        result[key]          = isSet ? '••••••••' : '';
        result[`${key}_set`] = isSet;
      } else {
        result[key] = this._cache[key] || '';
      }
    }
    return result;
  }

  /**
   * Returns the effective value for a key:
   * configStore cache → relevant process.env fallbacks → field default.
   * This is what config/oauth.js getters call.
   */
  getEffective(key) {
    const stored = this.get(key);
    if (stored) return stored;

    // Env-var fallback map (handles legacy P1AIC_ naming)
    const envFallbackMap = {
      pingone_environment_id: ['PINGONE_ENVIRONMENT_ID'],
      pingone_region:         ['PINGONE_REGION'],
      admin_client_id:        ['P1AIC_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_ID', 'VITE_PINGONE_CLIENT_ID'],
      admin_client_secret:    ['P1AIC_CLIENT_SECRET', 'PINGONE_ADMIN_CLIENT_SECRET', 'VITE_PINGONE_CLIENT_SECRET'],
      admin_redirect_uri:     ['P1AIC_REDIRECT_URI', 'PINGONE_ADMIN_REDIRECT_URI'],
      user_client_id:         ['P1AIC_USER_CLIENT_ID', 'PINGONE_USER_CLIENT_ID', 'VITE_PINGONE_CLIENT_ID'],
      user_client_secret:     ['P1AIC_USER_CLIENT_SECRET', 'PINGONE_USER_CLIENT_SECRET', 'VITE_PINGONE_CLIENT_SECRET'],
      user_redirect_uri:      ['P1AIC_USER_REDIRECT_URI', 'PINGONE_USER_REDIRECT_URI'],
      admin_role:             ['ADMIN_ROLE'],
      user_role:              ['USER_ROLE'],
      session_secret:         ['SESSION_SECRET'],
      frontend_url:           ['REACT_APP_CLIENT_URL', 'FRONTEND_ADMIN_URL'],
      mcp_server_url:         ['MCP_SERVER_URL'],
      debug_oauth:            ['DEBUG_OAUTH'],
    };

    const envVars = envFallbackMap[key] || [];
    for (const envKey of envVars) {
      const v = process.env[envKey];
      if (v) return v;
    }

    return FIELD_DEFS[key]?.default || '';
  }

  /** 'vercel-kv', 'upstash-direct', or 'sqlite' */
  getStorageType() {
    if (USE_KV) return KV_URL?.includes('upstash.io') ? 'upstash-direct' : 'vercel-kv';
    return 'sqlite';
  }

  /** True once the minimum required fields are stored. */
  isConfigured() {
    return !!(this.get('pingone_environment_id') && this.get('admin_client_id'));
  }

  /** Reset only works if called with correct SESSION_SECRET (basic safety). */
  async resetConfig() {
    if (USE_KV) {
      const { createClient } = require('@vercel/kv');
      const kv = createClient({ url: KV_URL, token: KV_TOKEN });
      await kv.del(KV_HASH_KEY);
    } else {
      const db = _getSQLite();
      db.prepare('DELETE FROM config').run();
    }
    this._cache = {};
    this._initPromise = null;
  }
}

// Singleton
const configStore = new ConfigStore();
module.exports = configStore;
module.exports.FIELD_DEFS   = FIELD_DEFS;
module.exports.SECRET_KEYS  = SECRET_KEYS;
