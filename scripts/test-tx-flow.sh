#!/usr/bin/env bash
# Usage: ./scripts/test-tx-flow.sh [api_key] [base_url]
#
# Full price-trigger → agent decision → tx signing push cycle.
# Safe to run repeatedly — resets state automatically each run.
#
# NOTE: After the trigger, wait 5-10 seconds for the agent to process.
# The tx_signing_request arrives on WS AFTER the agent's LLM call completes.

API_KEY="${1:-helloworld}"
BASE="${2:-http://localhost:8080}"

echo "=== agentX tx signing flow test ==="
echo "Base: $BASE  |  Key: $API_KEY"
echo ""

# 1. Check current live prices so we set a target_price that will actually trigger
echo "1. Fetching current prices..."
PRICES=$(curl -sf "$BASE/simulate/prices" -H "x-api-key: $API_KEY")
echo "   $PRICES"
echo ""

# 2. Reset — flip triggered alerts back to active, clear old pending txs
echo "2. Resetting state..."
RESET=$(curl -sf -X POST "$BASE/simulate/reset" -H "x-api-key: $API_KEY")
echo "   $RESET"
echo ""

# 3. Create a price alert with target just above current price so our trigger fires
#    We use 99999 as target_price with direction=below so ANY simulated price triggers it.
#    Change this to a real target once you're comfortable with the flow.
echo "3. Creating price alert (SOL below \$99999 — always triggers on simulate)..."
ALERT=$(curl -sf -X POST "$BASE/orders/alert" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token":"SOL","target_price":99999,"direction":"below","from_token":"SOL","to_token":"USDC","amount":0.01}')
echo "   $ALERT"
echo ""

# 4. Fire the simulate trigger — sets SOL to $140 and runs checkAlerts()
echo "4. Triggering price condition (SOL = \$140)..."
TRIGGER=$(curl -sf -X POST "$BASE/simulate/price-trigger" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token":"SOL","price":140}')
echo "   $TRIGGER"
echo ""

echo "=== Trigger fired. The agent is now deciding... ==="
echo ""
echo "Watch server logs for:"
echo "  [priceMonitor] Alert X triggered — handing off to agent"
echo "  [tool:getSolanaPrice] SOL = 140"
echo "  [tool:queueSigningRequest] tx=... reason=\"...\""
echo ""
echo "The tx_signing_request will arrive on your WS client in ~5-10 seconds."
echo ""
echo "--- To resend the same tx with a fresh blockhash (no re-trigger needed): ---"
echo "  curl -X POST $BASE/simulate/resend-tx -H \"x-api-key: $API_KEY\""
