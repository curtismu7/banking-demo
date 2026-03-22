// banking_api_server/services/agentMcpTokenService.js
/**
 * Resolves the access token sent to banking_mcp_server: either legacy (user-only exchange)
 * or on-behalf-of (subject = user, actor = agent OAuth client) when USE_AGENT_ACTOR_FOR_MCP=true.
 */
'use strict';

const configStore = require('./configStore');
const oauthService = require('./oauthService');
const { MCP_TOOL_SCOPES, getSessionAccessToken } = require('./mcpWebSocketClient');

/**
 * @param {import('express').Request} req
 * @param {string} tool
 * @returns {Promise<string|null>}
 */
async function resolveMcpAccessToken(req, tool) {
  const userToken = getSessionAccessToken(req);
  if (!userToken) return null;

  const mcpResourceUri = configStore.getEffective('mcp_resource_uri');
  const toolScopes = MCP_TOOL_SCOPES[tool] || ['banking:read'];

  const useActor =
    process.env.USE_AGENT_ACTOR_FOR_MCP === 'true' && process.env.AGENT_OAUTH_CLIENT_ID;

  if (useActor && mcpResourceUri) {
    try {
      const actorToken = await oauthService.getAgentClientCredentialsToken();
      return await oauthService.performTokenExchangeWithActor(
        userToken,
        actorToken,
        mcpResourceUri,
        toolScopes
      );
    } catch (err) {
      console.error('[agentMcpTokenService] Actor exchange failed, falling back to subject-only:', err.message);
      try {
        return await oauthService.performTokenExchange(userToken, mcpResourceUri, toolScopes);
      } catch (err2) {
        throw err2;
      }
    }
  }

  if (mcpResourceUri) {
    return oauthService.performTokenExchange(userToken, mcpResourceUri, toolScopes);
  }

  return userToken;
}

module.exports = {
  resolveMcpAccessToken,
};
