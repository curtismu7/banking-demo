/**
 * pingOneAuthorizeService.js
 *
 * Evaluates transactions against a PingOne Authorize policy (policy decision point).
 *
 * Worker credentials are read from configStore first, falling back to environment
 * variables so existing deployments continue to work without migration:
 *
 *   configStore:  authorize_worker_client_id / authorize_worker_client_secret
 *   Env vars:     PINGONE_AUTHORIZE_WORKER_CLIENT_ID / PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET
 *
 * The environment ID and region come from configStore (pingone_environment_id /
 * pingone_region) with the same env-var fallbacks used throughout the app.
 *
 * Exported functions:
 *   evaluateTransaction(params)  — full policy evaluation returning PERMIT/DENY/INDETERMINATE
 *   checkStepUpRequired(params)  — lightweight check: returns { stepUpRequired, reason }
 *   isConfigured()               — returns true if all required credentials are present
 */

'use strict';

const configStore = require('./configStore');

const REGION_TLD_MAP = {
  com: 'com',
  eu: 'eu',
  ca: 'ca',
  asia: 'asia',
  'com.au': 'com.au',
};

// ---------------------------------------------------------------------------
// Credential resolution — configStore first, env var fallback
// ---------------------------------------------------------------------------

function _getCredentials() {
  const envId =
    configStore.get('pingone_environment_id') ||
    process.env.PINGONE_ENVIRONMENT_ID;

  const region =
    configStore.get('pingone_region') ||
    process.env.PINGONE_REGION ||
    'com';

  const clientId =
    configStore.get('authorize_worker_client_id') ||
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID;

  const clientSecret =
    configStore.get('authorize_worker_client_secret') ||
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET;

  const regionTld = REGION_TLD_MAP[(region || 'com').toLowerCase()] || 'com';

  return { envId, clientId, clientSecret, regionTld };
}

const apiBase  = (tld) => `https://api.pingone.${tld}`;
const authBase = (tld) => `https://auth.pingone.${tld}`;

// ---------------------------------------------------------------------------
// Worker token (client credentials grant)
// ---------------------------------------------------------------------------

/**
 * Obtain a short-lived worker access_token via client credentials.
 * @returns {Promise<string>} access_token
 */
async function getWorkerToken() {
  const { envId, clientId, clientSecret, regionTld } = _getCredentials();

  if (!envId || !clientId || !clientSecret) {
    throw new Error(
      'PingOne Authorize worker credentials are not fully configured. ' +
      'Set authorize_worker_client_id and authorize_worker_client_secret in ' +
      'Admin → Configuration → PingOne Authorize, or set ' +
      'PINGONE_AUTHORIZE_WORKER_CLIENT_ID and PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET ' +
      'environment variables.'
    );
  }

  const tokenUrl = `${authBase(regionTld)}/${envId}/as/token`;
  const encoded  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Worker token response did not include access_token');
  }
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a transaction against the configured PingOne Authorize policy
 * decision point.
 *
 * @param {object} params
 * @param {string} params.policyId  - PDP ID (from configStore or runtimeSettings)
 * @param {string} params.userId    - Subject performing the transaction
 * @param {number} params.amount    - Transaction amount
 * @param {string} params.type      - 'transfer' | 'withdrawal' | 'deposit'
 * @param {string} [params.acr]     - ACR value from the user's token
 * @param {object} [params.context] - Additional context attributes to include
 * @returns {Promise<{ decision: 'PERMIT'|'DENY'|'INDETERMINATE', stepUpRequired: boolean, raw: object }>}
 */
async function evaluateTransaction({ policyId, userId, amount, type, acr, context = {} }) {
  const { envId, regionTld } = _getCredentials();
  if (!envId) throw new Error('PingOne environment ID is not configured.');
  if (!policyId) throw new Error('authorize_policy_id is not configured.');

  const workerToken = await getWorkerToken();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/governance/policyDecisionPoints/${policyId}/evaluate`;

  const payload = {
    context: {
      user: {
        id: userId,
        acr: acr || null,
      },
      transaction: {
        amount,
        type,
        timestamp: new Date().toISOString(),
      },
      ...context,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PingOne Authorize evaluation failed (${response.status}): ${text}`);
  }

  const raw = await response.json();
  const decision = raw.decision || 'INDETERMINATE';

  // The policy may signal step-up is needed via an obligation or advice attribute
  const stepUpRequired = _extractStepUpRequired(raw);

  return { decision, stepUpRequired, raw };
}

/**
 * Lightweight check: call the PingOne Authorize endpoint specifically to
 * determine whether step-up MFA is required for this transaction, without
 * rendering a final permit/deny decision.
 *
 * Returns early (stepUpRequired: false) if Authorize is not configured.
 *
 * @param {object} params
 * @param {string} params.policyId
 * @param {string} params.userId
 * @param {number} params.amount
 * @param {string} params.type
 * @param {string} [params.acr]
 * @returns {Promise<{ stepUpRequired: boolean, reason: string|null, raw: object|null }>}
 */
async function checkStepUpRequired({ policyId, userId, amount, type, acr }) {
  if (!isConfigured() || !policyId) {
    return { stepUpRequired: false, reason: null, raw: null };
  }

  try {
    const { decision, stepUpRequired, raw } = await evaluateTransaction({
      policyId,
      userId,
      amount,
      type,
      acr,
      context: { checkType: 'step_up_check' },
    });

    if (stepUpRequired) {
      return { stepUpRequired: true, reason: 'policy_step_up_obligation', raw };
    }

    // A DENY at the check stage also implies step-up or harder block
    if (decision === 'DENY') {
      return { stepUpRequired: true, reason: 'policy_deny', raw };
    }

    return { stepUpRequired: false, reason: null, raw };
  } catch (err) {
    console.warn(`[Authorize] checkStepUpRequired failed — defaulting to not required: ${err.message}`);
    return { stepUpRequired: false, reason: null, raw: null };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if all required credentials are available (configStore or env).
 */
function isConfigured() {
  const { envId, clientId, clientSecret } = _getCredentials();
  const policyId =
    configStore.get('authorize_policy_id') ||
    process.env.PINGONE_AUTHORIZE_POLICY_ID;
  return !!(envId && clientId && clientSecret && policyId);
}

/**
 * Extract step-up requirement from a PingOne Authorize raw response.
 * Policies can signal step-up via an obligation with type 'STEP_UP' or via
 * an advice attribute. Returns true if any such signal is found.
 */
function _extractStepUpRequired(raw) {
  const obligations = raw.obligations || raw.details?.obligations || [];
  if (obligations.some((o) => (o.type || o.id || '').toUpperCase().includes('STEP_UP'))) {
    return true;
  }
  const advice = raw.advice || raw.details?.advice || [];
  if (advice.some((a) => (a.type || a.id || '').toUpperCase().includes('STEP_UP'))) {
    return true;
  }
  return false;
}

module.exports = { evaluateTransaction, checkStepUpRequired, isConfigured, getWorkerToken };

