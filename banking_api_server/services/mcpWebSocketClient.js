// banking_api_server/services/mcpWebSocketClient.js
/**
 * JSON-RPC over WebSocket client for banking_mcp_server (MCP 2024-11-05).
 * Shared by /api/mcp/tool and /api/mcp/inspector/*.
 */
const WebSocket = require('ws');
const configStore = require('./configStore');

/** Scopes requested for RFC 8693 token exchange per MCP tool (must match BankingToolRegistry names). */
const MCP_TOOL_SCOPES = {
  get_my_accounts: ['banking:accounts:read'],
  get_account_balance: ['banking:accounts:read'],
  get_my_transactions: ['banking:transactions:read'],
  create_transfer: ['banking:transactions:write'],
  create_deposit: ['banking:transactions:write'],
  create_withdrawal: ['banking:transactions:write'],
  query_user_by_email: ['ai_agent'],
  // Legacy aliases (if still used anywhere)
  list_accounts: ['banking:accounts:read'],
  list_transactions: ['banking:transactions:read'],
  transfer: ['banking:transactions:write'],
  deposit: ['banking:transactions:write'],
  withdraw: ['banking:transactions:write'],
};

function getMcpServerUrl() {
  return configStore.getEffective('mcp_server_url') || 'ws://localhost:8080';
}

function getSessionAccessToken(req) {
  const t = req.session?.oauthTokens;
  if (!t) return null;
  return t.accessToken || t.access_token || null;
}

/**
 * After initialize, run one follow-up JSON-RPC method and return the result body.
 * @param {'tools/list'|'tools/call'} followMethod
 * @param {object} followParams
 */
function mcpRpc(agentToken, followMethod, followParams) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(getMcpServerUrl());
    let msgId = 1;
    let initialized = false;

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('MCP call timed out'));
    }, 15000);

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('open', () => {
      const initParams = {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'banking-api-server' },
      };
      if (agentToken) initParams.agentToken = agentToken;
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msgId++,
          method: 'initialize',
          params: initParams,
        })
      );
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!initialized) {
        initialized = true;
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msgId++,
            method: followMethod,
            params: followParams || {},
          })
        );
        return;
      }

      clearTimeout(timeout);
      ws.close();

      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    });
  });
}

function mcpListTools(agentToken) {
  return mcpRpc(agentToken, 'tools/list', {});
}

function mcpCallTool(toolName, toolParams, agentToken) {
  return mcpRpc(agentToken, 'tools/call', {
    name: toolName,
    arguments: toolParams || {},
  });
}

module.exports = {
  MCP_TOOL_SCOPES,
  getMcpServerUrl,
  getSessionAccessToken,
  mcpListTools,
  mcpCallTool,
};
