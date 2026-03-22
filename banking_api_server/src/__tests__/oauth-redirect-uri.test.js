/**
 * @file oauth-redirect-uri.test.js
 * @description Redirect URIs sent to PingOne must match allowlist; PUBLIC_APP_URL must win over deployment host.
 */

const configStore = require('../../services/configStore');
const {
  getAdminRedirectUri,
  getUserRedirectUri,
  getOAuthRedirectDebugInfo,
} = require('../../services/oauthRedirectUris');

function mockReq(host, forwardedHost) {
  return {
    protocol: 'https',
    get(name) {
      if (name === 'host') return host;
      if (name === 'x-forwarded-host') return forwardedHost;
      return undefined;
    },
  };
}

describe('oauthRedirectUris', () => {
  let origGetEffective;

  beforeEach(() => {
    origGetEffective = configStore.getEffective.bind(configStore);
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (['admin_redirect_uri', 'user_redirect_uri', 'frontend_url'].includes(key)) return '';
      return origGetEffective(key);
    });
  });

  afterEach(() => {
    configStore.getEffective.mockRestore();
    delete process.env.PUBLIC_APP_URL;
    delete process.env.REACT_APP_CLIENT_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL;
  });

  it('uses PUBLIC_APP_URL for admin and user callbacks on Vercel (ignores deployment host)', () => {
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    const req = mockReq('banking-demo-ephemeral-hash.vercel.app');
    expect(getAdminRedirectUri(req, { silent: true })).toBe(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/callback'
    );
    expect(getUserRedirectUri(req, { silent: true })).toBe(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/user/callback'
    );
  });

  it('uses localhost:3001 paths when not on Vercel', () => {
    const req = mockReq('localhost:3001');
    expect(getAdminRedirectUri(req, { silent: true })).toBe(
      'http://localhost:3001/api/auth/oauth/callback'
    );
    expect(getUserRedirectUri(req, { silent: true })).toBe(
      'http://localhost:3001/api/auth/oauth/user/callback'
    );
  });

  it('getOAuthRedirectDebugInfo lists URIs to register in PingOne', () => {
    process.env.PUBLIC_APP_URL = 'https://banking-demo-puce.vercel.app';
    process.env.VERCEL = '1';
    const info = getOAuthRedirectDebugInfo(mockReq('other.vercel.app'));
    expect(info.canonicalOrigin).toBe('https://banking-demo-puce.vercel.app');
    expect(info.pingOneRegisterThese).toContain(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/callback'
    );
    expect(info.pingOneRegisterThese).toContain(
      'https://banking-demo-puce.vercel.app/api/auth/oauth/user/callback'
    );
  });
});
