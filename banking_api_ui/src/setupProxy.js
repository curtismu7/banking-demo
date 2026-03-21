/**
 * CRA custom dev proxy — replaces the static "proxy" field in package.json.
 *
 * Target is read from REACT_APP_API_PORT (default 3001) so run-bank.sh can
 * pass PORT=3002 without touching source files.
 *
 * Standard start:    API on :3001 HTTP  (REACT_APP_API_PORT unset / 3001)
 * run-bank.sh start: API on :3002 HTTPS (REACT_APP_API_PORT=3002, REACT_APP_API_HTTPS=true)
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const apiPort = process.env.REACT_APP_API_PORT || '3001';
  const apiHttps = process.env.REACT_APP_API_HTTPS === 'true';
  const protocol = apiHttps ? 'https' : 'http';
  const target = `${protocol}://localhost:${apiPort}`;

  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      secure: false, // allow locally-trusted mkcert certs
    })
  );
};
