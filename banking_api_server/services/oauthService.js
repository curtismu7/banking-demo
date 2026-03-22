const axios = require('axios');
const crypto = require('crypto');
const oauthConfig = require('../config/oauth');

const DEBUG_TOKENS = process.env.DEBUG_TOKENS === 'true';

// Utility function to decode and log OAuth token information
const logTokenInfo = (token, context = '') => {
  if (!DEBUG_TOKENS) return;
  
  try {
    // Parse JWT without verification (just for reading claims)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log(`🔐 [${context}] Invalid token format`);
      return;
    }
    
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    if (!header || !payload) {
      console.log(`🔐 [${context}] Failed to decode token`);
      return;
    }
    
    console.log(`🔐 [${context}] Token Information:`);
    console.log(`   Algorithm: ${header.alg}`);
    console.log(`   Type: ${header.typ}`);
    if (header.kid) console.log(`   Key ID: ${header.kid}`);
    
    console.log(`   Subject: ${payload.sub || 'N/A'}`);
    console.log(`   Issuer: ${payload.iss || 'N/A'}`);
    console.log(`   Audience: ${Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud || 'N/A'}`);
    
    if (payload.exp) {
      const expDate = new Date(payload.exp * 1000);
      const now = new Date();
      const timeUntilExp = expDate.getTime() - now.getTime();
      console.log(`   Expires: ${expDate.toISOString()} (in ${Math.round(timeUntilExp / 1000 / 60)} minutes)`);
    }
    
    if (payload.iat) {
      const iatDate = new Date(payload.iat * 1000);
      console.log(`   Issued At: ${iatDate.toISOString()}`);
    }
    
    if (payload.preferred_username) console.log(`   Username: ${payload.preferred_username}`);
    if (payload.email) console.log(`   Email: ${payload.email}`);
    if (payload.given_name) console.log(`   First Name: ${payload.given_name}`);
    if (payload.family_name) console.log(`   Last Name: ${payload.family_name}`);
    
    // Log roles/permissions
    if (payload.realm_access?.roles) {
      console.log(`   Realm Roles: ${payload.realm_access.roles.join(', ')}`);
    }
    if (payload.resource_access) {
      console.log(`   Resource Access: ${JSON.stringify(payload.resource_access)}`);
    }
    if (payload.scope) {
      console.log(`   Scopes: ${payload.scope}`);
    }
    
  } catch (error) {
    console.log(`🔐 [${context}] Error decoding token: ${error.message}`);
  }
};

class OAuthService {
  constructor() {
    this.config = oauthConfig;
  }

  /**
   * Generate a PKCE code_verifier (random 64-byte hex string)
   */
  generateCodeVerifier() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Derive PKCE code_challenge (S256) from code_verifier
   */
  generateCodeChallenge(codeVerifier) {
    return crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
  }

  /**
   * Generate authorization URL for the authorization code flow with PKCE (S256)
   */
  generateAuthorizationUrl(state, codeVerifier, redirectUri) {
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri || this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token.
   * codeVerifier must match the code_challenge sent during /authorize (PKCE S256).
   */
  async exchangeCodeForToken(code, codeVerifier, redirectUri) {
    try {
      const body = {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri || this.config.redirectUri,
        client_id: this.config.clientId,
      };
      // Include client_secret only if present (not required when using PKCE with public clients)
      if (this.config.clientSecret) {
        body.client_secret = this.config.clientSecret;
      }
      // Always send code_verifier for PKCE
      if (codeVerifier) {
        body.code_verifier = codeVerifier;
      }
      const tokenResponse = await axios.post(this.config.tokenEndpoint, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // Log the received access token information
      if (tokenResponse.data.access_token) {
        logTokenInfo(tokenResponse.data.access_token, 'OAuth Token Exchange');
      }

      return tokenResponse.data;
    } catch (error) {
      console.error('Token exchange error:', error.response?.data || error.message);
      throw new Error('Failed to exchange authorization code for token');
    }
  }

  /**
   * RFC 8693 Token Exchange — exchange a subject token for a narrowly-scoped
   * delegated token targeted at a specific audience (e.g. the MCP server).
   *
   * The resulting token will contain an `act` claim identifying this client
   * as the actor, and its scope/audience will be restricted to what was requested.
   *
   * PingOne must be configured to:
   *   1. Issue `may_act` on user tokens (naming this client_id as permitted actor)
   *   2. Allow the token-exchange grant type on this client
   */
  async performTokenExchange(subjectToken, audience, scopes) {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: audience,
      scope: scopeStr,
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('Token exchange response missing access_token');
      console.log(`[TokenExchange] Issued delegated token for audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      console.error('[TokenExchange] Failed:', error.response?.data || error.message);
      throw new Error(`Token exchange failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get user information from PingOne Core
   */
  async getUserInfo(accessToken) {
    try {
      const userInfoResponse = await axios.get(this.config.userInfoEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return userInfoResponse.data;
    } catch (error) {
      console.error('User info error:', error.response?.data || error.message);
      throw new Error('Failed to get user information');
    }
  }

  /**
   * Validate access token
   */
  async validateToken(accessToken) {
    try {
      // Validate token by making a request to userinfo endpoint
      const userInfo = await this.getUserInfo(accessToken);
      return {
        valid: true,
        userInfo: userInfo
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Check if user has admin role (deprecated - now handled in local user management)
   */
  hasAdminRole(userInfo) {
    // This method is kept for backward compatibility but is no longer used
    // Admin role checking is now handled in the local user management system
    console.log('hasAdminRole called but deprecated - using local user management instead');
    return false;
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a user object from PingOne Core user info
   */
  createUserFromOAuth(userInfo) {
    return {
      id: userInfo.sub || userInfo.id,
      username: userInfo.preferred_username || userInfo.username || userInfo.email,
      email: userInfo.email,
      firstName: userInfo.given_name || userInfo.first_name || userInfo.name?.split(' ')[0] || '',
      lastName: userInfo.family_name || userInfo.last_name || userInfo.name?.split(' ').slice(1).join(' ') || '',
      role: 'customer', // Default role, will be overridden in OAuth callback if needed
      isActive: true,
      createdAt: new Date(),
      oauthProvider: 'pingone_ai_core',
      oauthId: userInfo.sub || userInfo.id
    };
  }
}

module.exports = new OAuthService();
