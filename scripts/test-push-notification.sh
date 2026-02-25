#!/usr/bin/env bash
# Usage: ./scripts/test-push-notification.sh [api_key] [base_url]
#
# Tests the notification-open → signing flow in isolation:
#   1. Builds a real devnet tx
#   2. Pushes it via WS + Expo push notification
#   3. Waits for you to test on mobile
#   4. Cleans up the pending tx
#
# Use this when you want to test what happens when:
#   - App is in background, notification arrives, user taps it
#   - App reconnects to WS and receives the pending tx_signing_request
# No agent, no price alert, no waiting.

API_KEY="${1:-helloworld}"
BASE="${2:-http://localhost:8080}"

echo "=== Push notification flow test ==="
echo "Base: $BASE  |  Key: $API_KEY"
echo ""

# 1. Push the tx
echo "1. Building tx and pushing notification..."
RESPONSE=$(curl -sf -X POST "$BASE/simulate/push-tx" -H "x-api-key: $API_KEY")

if [ $? -ne 0 ]; then
  echo "   ERROR: request failed. Is the server running?"
  exit 1
fi

echo "   $RESPONSE"
echo ""

TX_ID=$(echo "$RESPONSE" | grep -o '"tx_id":"[^"]*"' | cut -d'"' -f4)
WS_CLIENTS=$(echo "$RESPONSE" | grep -o '"ws_clients_notified":[0-9]*' | cut -d':' -f2)

echo "   tx_id:   $TX_ID"
echo "   WS clients notified: $WS_CLIENTS"
echo ""

if [ "$WS_CLIENTS" = "0" ]; then
  echo "   NOTE: No WS clients connected — tx was stored and Expo push was sent."
  echo "   When the app opens and connects it will receive the pending tx automatically."
else
  echo "   tx_signing_request sent to $WS_CLIENTS connected client(s) via WS."
fi

echo ""
echo "=== Test on mobile now ==="
echo "   - Background test: lock your phone, wait for the push notification, tap it"
echo "   - Foreground test: the signing sheet should have appeared already"
echo ""
echo "Press ENTER when you're done testing to clean up..."
read -r

# 2. Clean up — delete the pending tx
echo "Cleaning up..."
RESET=$(curl -sf -X POST "$BASE/simulate/reset" -H "x-api-key: $API_KEY")
echo "   $RESET"
echo ""
echo "=== Done ==="
