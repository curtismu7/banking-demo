// banking_api_ui/src/components/education/LoginFlowPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function LoginFlowPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What happens',
      content: (
        <>
          <h3>Ten-step login walkthrough</h3>
          <ol>
            <li>You click <strong>Admin</strong> or <strong>Customer</strong> sign-in.</li>
            <li>The Banking BFF starts the OAuth 2.0 <strong>authorization code + PKCE</strong> flow.</li>
            <li>The server generates a <code>code_verifier</code> and <code>code_challenge</code>, stores the verifier server-side, and redirects your browser to PingOne.</li>
            <li>PingOne shows the login / consent UI; you enter credentials (and MFA if required).</li>
            <li>PingOne redirects back to the registered <code>redirect_uri</code> with an <strong>authorization code</strong> and the same <code>state</code> value (CSRF protection).</li>
            <li>The BFF validates <code>state</code>, exchanges the code at <code>POST …/as/token</code> with the code verifier.</li>
            <li>PingOne returns <strong>T1</strong> (access token, often a JWT) and usually a refresh token. Depending on policy, T1 may include <code>may_act</code> for later delegation.</li>
            <li>The BFF stores tokens in the <strong>server session</strong> and issues an <strong>httpOnly session cookie</strong> to your browser — T1 is not exposed to JavaScript.</li>
            <li>The session may call <code>session.regenerate()</code> on login to reduce fixation risk.</li>
            <li>You land on <code>/admin</code> or <code>/dashboard</code>; subsequent API calls use the session cookie only.</li>
          </ol>
        </>
      ),
    },
    {
      id: 'ciba',
      label: 'CIBA (OOB)',
      content: (
        <>
          <h3>CIBA vs browser login (this panel)</h3>
          <p>
            <strong>Authorization Code + PKCE</strong> (tabs above) uses a <strong>redirect</strong> to PingOne and back.
            <strong> CIBA</strong> (Client-Initiated Backchannel Authentication) keeps the user in the app: the BFF calls{' '}
            <code>POST …/bc-authorize</code> with <code>login_hint</code> and <code>binding_message</code>, then polls{' '}
            <code>POST …/token</code> with <code>grant_type=ciba</code> until the user approves.
          </p>
          <p>
            <strong>Email or push</strong> is determined by your <strong>PingOne / DaVinci</strong> configuration, not by this SPA.
            An <strong>email-only</strong> flow (approve link in the inbox) does not require PingOne MFA push or a registered phone app.
            A <strong>push</strong> flow uses your MFA policy and registered devices (e.g. PingID / MS Authenticator).
          </p>
          <p>
            For sequence diagrams, PingOne admin steps, and a live <strong>Try It</strong> demo, open the floating{' '}
            <strong>CIBA guide</strong> (bottom-right).
          </p>
        </>
      ),
    },
    {
      id: 'pkce',
      label: 'PKCE deep dive',
      content: (
        <>
          <h3>Why PKCE?</h3>
          <p>
            PKCE (RFC 7636) proves that the same app that started the authorize request is exchanging the code — even for public clients
            that cannot store a secret. The authorization server never sees the raw <code>code_verifier</code> until the token step.
          </p>
          <h3>Two requests side by side</h3>
          <p><strong>1) Authorize (browser redirect)</strong></p>
          <pre className="edu-code">{`GET /as/authorize?
  response_type=code
  &client_id=...
  &redirect_uri=...
  &scope=openid%20...
  &state=<random>
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256`}</pre>
          <p><strong>2) Token (server-to-server)</strong></p>
          <pre className="edu-code">{`POST /as/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<auth_code>
&redirect_uri=...
&client_id=...
&client_secret=...   (confidential client)
&code_verifier=<original secret>`}</pre>
          <p>PingOne hashes the verifier and must match the challenge from step 1. An attacker who intercepts the redirect <strong>cannot</strong> exchange the code without the verifier.</p>
        </>
      ),
    },
    {
      id: 'tokens',
      label: 'The tokens',
      content: (
        <>
          <h3>Annotated JWT payload (example)</h3>
          <pre className="edu-code">{`{
  "sub": "user id at PingOne",
  "aud": "PingOne audience / resource",
  "scope": "openid banking:read ...",
  "may_act": { "client_id": "...", ... },  // if policy issues delegation hint
  "exp": 1234567890,
  "iss": "https://auth.pingone.com/.../as"
}`}</pre>
          <ul>
            <li><strong>sub</strong> — stable subject identifier.</li>
            <li><strong>aud</strong> — who the token is for (may be PingOne resource identifier).</li>
            <li><strong>scope</strong> — granted OAuth scopes.</li>
            <li><strong>may_act</strong> — optional; indicates which client may perform token exchange on behalf of this user.</li>
            <li><strong>exp</strong> / <strong>iss</strong> — expiry and issuer.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'security',
      label: 'Security notes',
      content: (
        <>
          <h3>Why T1 never touches the browser</h3>
          <p>
            Access tokens are stored in the BFF session. The browser only holds a <strong>session cookie</strong> (httpOnly, Secure in production),
            so XSS cannot read T1 from JavaScript.
          </p>
          <h3>Session fixation</h3>
          <p>On successful login, the server should regenerate the session id so a pre-issued cookie cannot be reused to hijack the new session.</p>
          <h3>State parameter</h3>
          <p><code>state</code> is generated per authorize request and echoed in the callback — if it does not match, the callback is rejected (CSRF / mix-up defense).</p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Login flow (Authorization Code + PKCE)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
