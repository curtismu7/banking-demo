#!/usr/bin/env bash
# run-bank.sh — Start the full Banking app on api.pingdemo.com (HTTPS) so it
# can run alongside MasterFlow (OAuth Playground) on :3000 / :3001.
#
# Port layout:
#   Banking API Server  → https://api.pingdemo.com:3002
#   Banking UI          → https://api.pingdemo.com:4000
#   Banking MCP Server  → localhost:8080
#   LangChain Agent     → localhost:8888
#
# One-time setup (run once each, requires sudo for /etc/hosts):
#   echo '127.0.0.1  api.pingdemo.com' | sudo tee -a /etc/hosts
#   mkcert -install   # install local CA (once per machine)
#
# Usage:
#   ./run-bank.sh           # start all services
#   ./run-bank.sh stop      # stop all services started by this script

set -e

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

API_HOST="api.pingdemo.com"
API_PORT=3002
UI_PORT=4000
API_URL="https://${API_HOST}:${API_PORT}"
CLIENT_URL="https://${API_HOST}:${UI_PORT}"

CERT_DIR="${BASEDIR}/certs"
CERT_FILE="${CERT_DIR}/api.pingdemo.com+2.pem"
KEY_FILE="${CERT_DIR}/api.pingdemo.com+2-key.pem"

# ── /etc/hosts check ─────────────────────────────────────────────────────────────────
if ! grep -q "${API_HOST}" /etc/hosts 2>/dev/null; then
  echo "⚠️  ${API_HOST} is not in /etc/hosts."
  echo "   Run this once to add it, then restart the script:"
  echo "   echo '127.0.0.1  ${API_HOST}' | sudo tee -a /etc/hosts"
  echo ""
  echo "   Continuing with localhost fallback for now..."
  API_URL="https://localhost:${API_PORT}"
  CLIENT_URL="https://localhost:${UI_PORT}"
fi

# ── SSL cert check / auto-generate ───────────────────────────────────────────
if [[ ! -f "${CERT_FILE}" ]] || [[ ! -f "${KEY_FILE}" ]]; then
  if command -v mkcert &>/dev/null; then
    echo "🔐 Generating SSL certs for ${API_HOST}..."
    mkdir -p "${CERT_DIR}"
    (cd "${CERT_DIR}" && mkcert "${API_HOST}" localhost 127.0.0.1)
    echo "✅ Certs created in ${CERT_DIR}"
  else
    echo "⚠️  mkcert not found — install with: brew install mkcert && mkcert -install"
    echo "   Falling back to HTTP..."
    API_URL="http://${API_HOST}:${API_PORT}"
    CLIENT_URL="http://${API_HOST}:${UI_PORT}"
  fi
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
  echo "🔗 Starting LangChain Agent on :8888 (HTTPS if certs available)..."
  (
    cd "$BASEDIR/langchain_agent"
    [[ -d venv ]] && source venv/bin/activate
    if [[ -f "${CERT_FILE}" ]] && [[ -f "${KEY_FILE}" ]]; then
      python3 -m uvicorn "${ENTRY}:app" --port 8888 \
        --ssl-keyfile "${KEY_FILE}" --ssl-certfile "${CERT_FILE}" \
        > /tmp/bank-langchain-agent.log 2>&1
    else
      python3 -m uvicorn "${ENTRY}:app" --port 8888 > /tmp/bank-langchain-agent.log 2>&1
    fi
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
  HTTPS=true \
  SSL_CRT_FILE=${CERT_FILE} \
  SSL_KEY_FILE=${KEY_FILE} \
  REACT_APP_API_URL=${API_URL} \
  REACT_APP_API_PORT=${API_PORT} \
  REACT_APP_API_HTTPS=true \
  REACT_APP_CLIENT_URL=${CLIENT_URL} \
  DANGEROUSLY_DISABLE_HOST_CHECK=true \
  WDS_SOCKET_PORT=0 \
  npm start > /tmp/bank-ui.log 2>&1
) &
echo $! > "$PID_UI"

# ── Banner ───────────────────────────────────────────────────────────────────
# shellcheck disable=SC2034
BOLD='\033[1m'
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[1;35m'
BLUE='\033[1;34m'
WHITE='\033[1;37m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}*******************************************************************${RESET}"
echo -e "${CYAN}${BOLD}*                                                                 *${RESET}"
echo -e "${CYAN}${BOLD}*          🏦  BANKING DEMO — ALL SERVICES STARTED  🏦            *${RESET}"
echo -e "${CYAN}${BOLD}*                                                                 *${RESET}"
echo -e "${CYAN}${BOLD}*******************************************************************${RESET}"
echo ""
echo -e "${WHITE}${BOLD}  ABOUT${RESET}"
echo -e "${DIM}  PingOne-powered banking demo with OAuth 2.0 login, AI banking${RESET}"
echo -e "${DIM}  agent (BankingAgent FAB), and MCP tool integration. Runs${RESET}"
echo -e "${DIM}  alongside MasterFlow with no port conflicts.${RESET}"
echo ""
echo -e "${GREEN}${BOLD}  ┌─ URLS ──────────────────────────────────────────────────────┐${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  🌐  Banking UI (App)     ${YELLOW}${BOLD}${CLIENT_URL}${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  ⚙️   Banking UI (Config)  ${YELLOW}${BOLD}${CLIENT_URL}/config${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  🔐  Admin Login flow      ${YELLOW}${BOLD}${API_URL}/api/auth/oauth/login${RESET}"
echo -e "${GREEN}${BOLD}  │${RESET}  👤  User Login flow       ${YELLOW}${BOLD}${API_URL}/api/auth/oauth/user/login${RESET}"
echo -e "${GREEN}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${BLUE}${BOLD}  ┌─ PORTS ─────────────────────────────────────────────────────┐${RESET}"
echo -e "${BLUE}${BOLD}  │${RESET}  ${MAGENTA}:${UI_PORT}${RESET}   Banking React UI     (CRA dev server)"
echo -e "${BLUE}${BOLD}  │${RESET}  ${MAGENTA}:${API_PORT}${RESET}   Banking API Server   (Express)"
echo -e "${BLUE}${BOLD}  │${RESET}  ${MAGENTA}:8080${RESET}  Banking MCP Server   (tool proxy)"
echo -e "${BLUE}${BOLD}  │${RESET}  ${MAGENTA}:8888${RESET}  LangChain Agent      (Python FastAPI)"
echo -e "${BLUE}${BOLD}  │${RESET}  ${DIM}:3000  MasterFlow UI      (not managed here)${RESET}"
echo -e "${BLUE}${BOLD}  │${RESET}  ${DIM}:3001  MasterFlow API     (not managed here)${RESET}"
echo -e "${BLUE}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${MAGENTA}${BOLD}  ┌─ QUICK START ───────────────────────────────────────────────┐${RESET}"
echo -e "${MAGENTA}${BOLD}  │${RESET}  1. Open ${YELLOW}${CLIENT_URL}/config${RESET} and enter PingOne credentials"
echo -e "${MAGENTA}${BOLD}  │${RESET}  2. Open ${YELLOW}${CLIENT_URL}${RESET} — click ${WHITE}${BOLD}Login${RESET} to start an OAuth flow"
echo -e "${MAGENTA}${BOLD}  │${RESET}  3. After login, use the 🤖 FAB (bottom-right) for BankingAgent"
echo -e "${MAGENTA}${BOLD}  │${RESET}     • Ask: balance, accounts, transactions, withdraw, transfer"
echo -e "${MAGENTA}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${WHITE}${BOLD}  ┌─ LOGS / DEBUG ──────────────────────────────────────────────┐${RESET}"
echo -e "${WHITE}${BOLD}  │${RESET}  tail -f /tmp/bank-api-server.log"
echo -e "${WHITE}${BOLD}  │${RESET}  tail -f /tmp/bank-ui.log"
echo -e "${WHITE}${BOLD}  │${RESET}  tail -f /tmp/bank-mcp-server.log"
echo -e "${WHITE}${BOLD}  └─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "${YELLOW}  ℹ️  UI takes ~20s to compile.  To stop: ${BOLD}bash run-bank.sh stop${RESET}"
echo ""
echo -e "${CYAN}${BOLD}*******************************************************************${RESET}"
echo ""
