#!/usr/bin/env bash
#
# Renova a conexão MCP (Pipeboard) do usuário após trocar o META_ACCESS_TOKEN no Render.
#
# Uso:
#   ./scripts/reconnect-meta.sh <email> <senha> [base_url]
#
# O que faz:
#   1. Faz login (POST /api/auth/login) e obtém o JWT do usuário
#   2. Chama POST /api/mcp/auto-connect com esse JWT, que regrava
#      MCPConnection.metaAccessToken (criptografado) com o valor atual
#      de META_ACCESS_TOKEN configurado no servidor
#   3. Mostra o status final (GET /api/mcp/status)
#
# Pré-requisito: já ter atualizado META_ACCESS_TOKEN no Render
# (meta-ads-agent-backend → Environment) com o novo token do Meta.

set -euo pipefail

EMAIL="${1:?Uso: $0 <email> <senha> [base_url]}"
PASSWORD="${2:?Uso: $0 <email> <senha> [base_url]}"
BASE_URL="${3:-https://meta-ads-agent-backend.onrender.com}"

echo "→ Login em $BASE_URL ..."
LOGIN_RESPONSE=$(curl -sS -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "✗ Falha no login. Resposta:"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✓ Login OK"

echo "→ Reconectando MCP (auto-connect) ..."
CONNECT_RESPONSE=$(curl -sS -X POST "$BASE_URL/api/mcp/auto-connect" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "$CONNECT_RESPONSE"

echo "→ Status da conexão:"
curl -sS "$BASE_URL/api/mcp/status" -H "Authorization: Bearer $TOKEN"
echo
