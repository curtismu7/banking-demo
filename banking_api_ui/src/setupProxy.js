/**
 * CRA custom dev proxy — replaces the static "proxy" field in package.json.
 *
 * Target is read from REACT_APP_API_PORT (default 3001) so run-bank.sh can
 * pass PORT=3002 without touching source files.
 *
 * Standard start:    API lands on :3001  (REACT_APP_API_PORT unset / 3001)
 * run-bank.sh start: API lands on :3002  (REACT_APP_API_PORT=3002)
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const apiPort = process.env.REACT_APP_API_PORT || '3001';
  const target = `http://localhost:${apiPort}`;

  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
