#!/usr/bin/env bash
# run-bank.sh — Start the full Banking app on api.pingdemo.com so it can run
# alongside MasterFlow (OAuth Playground) which uses :3000 and :3001.
#
# Port layout:
#   Banking API Server  → api.pingdemo.com:3002
#   Banking UI          → api.pingdemo.com:4000
#   Banking MCP Server  → localhost:8080
#   LangChain Agent     → localhost:8888
#
# One-time /etc/hosts setup (run once, requires sudo):
#   echo '127.0.0.1  api.pingdemo.com' | sudo tee -a /etc/hosts
#
# Usage:
#   ./run-bank.sh           # start all services
#   ./run-bank.sh stop      # stop all services started by this script

set -e

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

API_HOST="api.pingdemo.com"
API_PORT=3002
UI_PORT=4000
API_URL="http://${API_HOST}:${API_PORT}"
CLIENT_URL="http://${API_HOST}:${UI_PORT}"

# ── /etc/hosts check ─────────────────────────────────────────────────────────
if ! grep -q "${API_HOST}" /etc/hosts 2>/dev/null; then
  echo "⚠️  ${API_HOST} is not in /etc/hosts."
  echo "   Run this once to add it, then restart the script:"
  echo "   echo '127.0.0.1  ${API_HOST}' | sudo tee -a /etc/hosts"
  echo ""
  echo "   Continuing with localhost fallback for now..."
  API_URL="http://localhost:${API_PORT}"
  CLIENT_URL="http://localhost:${UI_PORT}"
fi

# PID files — separate from start.sh so both can coexist
PID_API=/tmp/bank-api-server.pid
PID_MCP=/tmp/bank-mcp-server.pid
PID_AGENT=/tmp/bank-langchain-agent.pid
PID_UI=/tmp/bank-ui.pid

# ── Stop mode ───────────────────────────────────────────────────────────────
if [[ "${1}" == "stop" ]]; then
  echo "🛑 Stopping Banking services (run-bank.sh)..."
  for pid_file in "$PID_API" "$PID_MCP" "$PID_AGENT" "$PID_UI"; do
    if [[ -f "$pid_file" ]]; then
      PID=$(cat "$pid_file")
      if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" && echo "   Stopped PID $PID ($(basename "$pid_file" .pid))"
      fi
      rm -f "$pid_file"
    fi
  done
  echo "✅ Done."
  exit 0
fi

# ── Dependency check ─────────────────────────────────────────────────────────
for svc in banking_api_server banking_mcp_server banking_api_ui; do
  if [[ ! -d "$BASEDIR/$svc/node_modules" ]]; then
    echo "📦 Installing dependencies for $svc..."
    (cd "$BASEDIR/$svc" && npm install)
  fi
done

# ── Banking API Server (Express) on :3002 ────────────────────────────────────
echo "🚀 Starting Banking API Server on ${API_HOST}:${API_PORT}..."
(
  cd "$BASEDIR/banking_api_server"
  PORT=${API_PORT} \
  REACT_APP_CLIENT_URL=${CLIENT_URL} \
  FRONTEND_ADMIN_URL=${CLIENT_URL}/admin \
  FRONTEND_DASHBOARD_URL=${CLIENT_URL}/dashboard \
  npm start > /tmp/bank-api-server.log 2>&1
) &
echo $! > "$PID_API"

sleep 1

# ── Banking MCP Server on :8080 ──────────────────────────────────────────────
if [[ -d "$BASEDIR/banking_mcp_server" ]]; then
  echo "🤖 Starting Banking MCP Server on :8080..."
  (
    cd "$BASEDIR/banking_mcp_server"
    cp .env.development .env 2>/dev/null || true
    npm start > /tmp/bank-mcp-server.log 2>&1
  ) &
  echo $! > "$PID_MCP"
fi

# ── LangChain Agent on :8888 ─────────────────────────────────────────────────
if [[ -f "$BASEDIR/langchain_agent/main.py" ]] || [[ -f "$BASEDIR/langchain_agent/server.py" ]]; then
  ENTRY="main"
  [[ -f "$BASEDIR/langchain_agent/server.py" ]] && ENTRY="server"
  echo "🔗 Starting LangChain Agent on :8888..."
  (
    cd "$BASEDIR/langchain_agent"
    [[ -d venv ]] && source venv/bin/activate
    python3 -m uvicorn "${ENTRY}:app" --port 8888 > /tmp/bank-langchain-agent.log 2>&1
  ) &
  echo $! > "$PID_AGENT"
fi

# ── Banking UI (CRA) on :4000 ────────────────────────────────────────────────
# REACT_APP_API_PORT  → picked up by src/setupProxy.js to proxy /api/* to :3002
# REACT_APP_API_URL   → used by apiClient.js for absolute axios calls
# HOST                → binds CRA dev server to 0.0.0.0 so api.pingdemo.com resolves
# DANGEROUSLY_DISABLE_HOST_CHECK → allows non-localhost hostnames in CRA dev
echo "🌐 Starting Banking UI on ${CLIENT_URL}..."
(
  cd "$BASEDIR/banking_api_ui"
  HOST=0.0.0.0 \
  PORT=${UI_PORT} \
  REACT_APP_API_URL=${API_URL} \
  REACT_APP_API_PORT=${API_PORT} \
  REACT_APP_CLIENT_URL=${CLIENT_URL} \
  DANGEROUSLY_DISABLE_HOST_CHECK=true \
  WDS_SOCKET_PORT=0 \
  npm start > /tmp/bank-ui.log 2>&1
) &
echo $! > "$PID_UI"

echo ""
echo ""
echo "✅ Banking services started:"
echo "   Banking UI         : ${CLIENT_URL}"
echo "   Banking API Server : ${API_URL}"
echo "   Banking MCP Server : http://localhost:8080"
echo "   LangChain Agent    : http://localhost:8888"
echo ""
echo "   MasterFlow stays on :3000 / :3001 — no port conflicts"
echo ""
echo "📋 Logs (tail -f to watch):"
echo "   tail -f /tmp/bank-api-server.log"
echo "   tail -f /tmp/bank-ui.log"
echo ""
echo "ℹ️  To stop: bash run-bank.sh stop"
