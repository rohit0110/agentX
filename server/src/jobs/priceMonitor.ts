import Expo from "expo-server-sdk";
import {
  getActiveAlerts,
  markAlertTriggered,
  createPendingTx,
  getDevicePushTokens,
  AlertRow,
} from "../db/alertsDb";
import { clientRegistry } from "../ws/clientRegistry";
import { buildTestTransferTx } from "../solana/buildTx";

// ---------------------------------------------------------------------------
// Mock price feed — starts at realistic values, drifts slightly each tick.
// Phase 4 will replace this with real Helius / Jupiter price data.
// ---------------------------------------------------------------------------

export const mockPrices: Record<string, number> = {
  SOL: 185.42,
  USDC: 1.0,
  JUP: 1.23,
  BONK: 0.000038,
};

function drift(price: number, maxPct = 0.003): number {
  const factor = 1 + (Math.random() - 0.5) * 2 * maxPct;
  return Math.max(0, price * factor);
}

function tickPrices(): void {
  for (const token of Object.keys(mockPrices)) {
    if (token !== "USDC") {
      mockPrices[token] = drift(mockPrices[token]);
    }
  }
}

// ---------------------------------------------------------------------------
// Build a real Solana transaction.
// Currently: fixed 0.01 SOL transfer on devnet (test phase).
// Phase 4: replaced by Jupiter swap quote for the actual token pair.
// ---------------------------------------------------------------------------

async function buildTxPayload(): Promise<string> {
  return buildTestTransferTx();
}

// ---------------------------------------------------------------------------
// Send Expo push notifications (for clients not connected via WS)
// ---------------------------------------------------------------------------

const expo = new Expo();

async function sendExpoPush(
  alert: AlertRow,
  triggeredPrice: number,
  txId: string
): Promise<void> {
  const tokens = await getDevicePushTokens();
  if (tokens.length === 0) return;

  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return;

  const messages = validTokens.map((to) => ({
    to,
    sound: "default" as const,
    title: "Trade Alert",
    body: `${alert.token} hit $${triggeredPrice.toFixed(4)} — tap to sign your ${alert.from_token}→${alert.to_token} swap`,
    data: { type: "tx_signing_request", tx_id: txId },
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    console.log(`[priceMonitor] Expo push sent to ${validTokens.length} device(s)`);
  } catch (err) {
    console.error("[priceMonitor] Expo push error", err);
  }
}

// ---------------------------------------------------------------------------
// Core: check all active alerts against current mock prices
// ---------------------------------------------------------------------------

export async function checkAlerts(): Promise<void> {
  const alerts = await getActiveAlerts();
  if (alerts.length === 0) return;

  for (const alert of alerts) {
    const price = mockPrices[alert.token.toUpperCase()];
    if (price === undefined) {
      console.warn(`[priceMonitor] No mock price for token: ${alert.token}`);
      continue;
    }

    const target = Number(alert.target_price);
    const triggered =
      (alert.direction === "above" && price >= target) ||
      (alert.direction === "below" && price <= target);

    if (!triggered) continue;

    console.log(
      `[priceMonitor] Alert ${alert.id} triggered: ${alert.token} ${price.toFixed(4)} ${alert.direction} ${target}`
    );

    // Atomically mark alert triggered so concurrent ticks don't double-fire
    await markAlertTriggered(alert.id);

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5-min window to sign
    const amount = Number(alert.amount);

    // Build the real Solana transaction — hits devnet for a fresh blockhash
    const payload = await buildTxPayload();

    const tx = await createPendingTx({
      alert_id: alert.id,
      from_token: alert.from_token,
      to_token: alert.to_token,
      amount,
      payload,
      expires_at: expiresAt,
    });

    const wsMsg = {
      type: "tx_signing_request" as const,
      payload: {
        tx_id: tx.tx_id,
        from_token: alert.from_token,
        to_token: alert.to_token,
        amount,
        serialized_tx: payload,
        trigger: {
          alert_id: Number(alert.id),
          token: alert.token,
          target_price: target,
          triggered_price: price,
          direction: alert.direction,
        },
        expires_at: expiresAt.toISOString(),
      },
    };

    // Push to all connected WS clients
    clientRegistry.broadcast(wsMsg);
    console.log(
      `[priceMonitor] tx_signing_request pushed via WS to ${clientRegistry.size} client(s) — tx_id=${tx.tx_id}`
    );

    // Push notification for clients not connected (or as a parallel heads-up)
    await sendExpoPush(alert, price, tx.tx_id);
  }
}

// ---------------------------------------------------------------------------
// Exported for the simulate endpoint: override a price and check alerts
// ---------------------------------------------------------------------------

export async function triggerAtPrice(token: string, price: number): Promise<void> {
  mockPrices[token.toUpperCase()] = price;
  await checkAlerts();
}

// ---------------------------------------------------------------------------
// Start the polling loop
// ---------------------------------------------------------------------------

export function startPriceMonitor(intervalMs = 30_000): NodeJS.Timeout {
  console.log(`[priceMonitor] Starting — interval=${intervalMs}ms`);
  // Tick prices without a db check on first start (no alerts yet)
  const handle = setInterval(async () => {
    tickPrices();
    try {
      await checkAlerts();
    } catch (err) {
      console.error("[priceMonitor] checkAlerts error", err);
    }
  }, intervalMs);

  return handle;
}
