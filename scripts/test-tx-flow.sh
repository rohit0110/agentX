#!/usr/bin/env bash
# Usage: ./scripts/test-tx-flow.sh [api_key] [base_url]
# Runs the full price-trigger → tx signing push cycle in one shot.
# Safe to run repeatedly — resets state automatically each run.

API_KEY="${1:-helloworld}"
BASE="${2:-http://localhost:8080}"

echo "=== agentX tx signing flow test ==="
echo "Base: $BASE  |  Key: $API_KEY"
echo ""

# 1. Reset — flip triggered alerts back to active, clear old pending txs
echo "1. Resetting state..."
RESET=$(curl -sf -X POST "$BASE/simulate/reset" \
  -H "x-api-key: $API_KEY")
echo "   $RESET"
echo ""

# 2. Ensure at least one active alert exists (idempotent — creates a second if
#    all existing ones were cancelled, harmless if active ones already exist)
echo "2. Creating price alert (SOL below 150 → swap 1 SOL → USDC)..."
ALERT=$(curl -sf -X POST "$BASE/orders/alert" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token":"SOL","target_price":150,"direction":"below","from_token":"SOL","to_token":"USDC","amount":1}')
echo "   $ALERT"
echo ""

# 3. Fire the trigger — sets mock SOL to $140, runs checkAlerts()
echo "3. Triggering price condition (SOL = \$140)..."
TRIGGER=$(curl -sf -X POST "$BASE/simulate/price-trigger" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token":"SOL","price":140}')
echo "   $TRIGGER"
echo ""

echo "=== Done — watch your WS client / mobile for tx_signing_request ==="
echo ""
echo "To resend without re-triggering (fresh blockhash):"
echo "  curl -X POST $BASE/simulate/resend-tx -H \"x-api-key: $API_KEY\""
