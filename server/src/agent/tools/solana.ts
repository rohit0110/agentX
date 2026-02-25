import { tool } from "ai";
import { z } from "zod";
import { currentPrices } from "../../jobs/priceMonitor";
import { createAlert, createPendingTx, getPendingTxs } from "../../db/alertsDb";
import { clientRegistry } from "../../ws/clientRegistry";
import { buildTestTransferTx } from "../../solana/buildTx";
import { sendPushToDevices } from "../../notifications/expoPush";

// ---------------------------------------------------------------------------
// getSolanaPrice
// Reads from the shared mock price state that the price monitor ticks.
// Phase 4: replace with real Helius/Jupiter price feed.
// ---------------------------------------------------------------------------

export const getSolanaPriceTool = tool({
  description:
    "Get the current price of a Solana token in USD. Supported: SOL, USDC, JUP, BONK.",
  parameters: z.object({
    tokenSymbol: z.string().describe("Token symbol, e.g. SOL, USDC, JUP, BONK"),
  }),
  execute: async ({ tokenSymbol }) => {
    const symbol = tokenSymbol.toUpperCase();
    const price = currentPrices[symbol];
    console.log(`[tool:getSolanaPrice] ${symbol} = ${price}`);
    if (price === undefined) {
      return { symbol, price: null, error: `Unknown token: ${symbol}` };
    }
    return { symbol, price, currency: "USD", source: "mock" };
  },
});

// ---------------------------------------------------------------------------
// createPriceAlert
// User tells the agent "buy SOL when it drops below $150" → agent calls this.
// The price monitor picks it up on the next tick.
// ---------------------------------------------------------------------------

export const createPriceAlertTool = tool({
  description:
    "Register a price alert. When the token hits the target price the agent will be notified and can decide whether to queue a signing request. Use this when the user describes a trading strategy.",
  parameters: z.object({
    token: z.string().describe("Token to watch: SOL, JUP, BONK"),
    target_price: z.number().positive().describe("Price level that triggers the alert"),
    direction: z
      .enum(["above", "below"])
      .describe("Trigger when price goes above or below target"),
    from_token: z.string().describe("Token to sell when the alert fires"),
    to_token: z.string().describe("Token to buy when the alert fires"),
    amount: z.number().positive().describe("Amount of from_token to trade"),
  }),
  execute: async ({ token, target_price, direction, from_token, to_token, amount }) => {
    const alert = await createAlert({
      token: token.toUpperCase(),
      target_price,
      direction,
      from_token: from_token.toUpperCase(),
      to_token: to_token.toUpperCase(),
      amount,
    });

    console.log(
      `[tool:createPriceAlert] alert=${alert.id} ${token} ${direction} ${target_price}`
    );

    return {
      success: true,
      alert_id: Number(alert.id),
      token: token.toUpperCase(),
      target_price,
      direction,
      from_token: from_token.toUpperCase(),
      to_token: to_token.toUpperCase(),
      amount,
    };
  },
});

// ---------------------------------------------------------------------------
// queueSigningRequest
// The agent's primary action — builds a real Solana tx and pushes it to the
// mobile app via WebSocket (+ Expo push for background).
// The agent must provide a human-readable reason shown on the mobile UI.
// ---------------------------------------------------------------------------

export const queueSigningRequestTool = tool({
  description:
    "Send a transaction signing request to the user's mobile app. Call this ONLY after you have analysed the market and decided a trade should happen. The user sees your reason on their phone and can approve or reject it with their wallet.",
  parameters: z.object({
    from_token: z.string().describe("Token to sell, e.g. SOL"),
    to_token: z.string().describe("Token to buy, e.g. USDC"),
    amount: z.number().positive().describe("Amount of from_token"),
    reason: z
      .string()
      .describe(
        "One sentence shown to the user on their phone explaining why you recommend this trade. Be specific: include the price, the strategy, and what you expect. E.g. 'SOL dropped to $142 — executing your buy-the-dip strategy targeting $150 recovery.'"
      ),
  }),
  execute: async ({ from_token, to_token, amount, reason }) => {
    const serialized_tx = await buildTestTransferTx();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const tx = await createPendingTx({
      from_token: from_token.toUpperCase(),
      to_token: to_token.toUpperCase(),
      amount,
      payload: serialized_tx,
      expires_at: expiresAt,
    });

    const wsMsg = {
      type: "tx_signing_request" as const,
      payload: {
        tx_id: tx.tx_id,
        from_token: from_token.toUpperCase(),
        to_token: to_token.toUpperCase(),
        amount,
        serialized_tx,
        reason,
        trigger: {
          alert_id: 0,
          token: from_token.toUpperCase(),
          target_price: 0,
          triggered_price: 0,
          direction: "below" as const,
        },
        expires_at: expiresAt.toISOString(),
      },
    };

    clientRegistry.broadcast(wsMsg);

    await sendPushToDevices("agentX: Trade Ready to Sign", reason, {
      type: "tx_signing_request",
      tx_id: tx.tx_id,
    });

    console.log(
      `[tool:queueSigningRequest] tx=${tx.tx_id} clients=${clientRegistry.size} reason="${reason}"`
    );

    return {
      tx_id: tx.tx_id,
      status: "pushed_to_mobile",
      connected_clients: clientRegistry.size,
      message: `Signing request sent. The user will see: "${reason}"`,
    };
  },
});

// ---------------------------------------------------------------------------
// getPendingSigningRequests
// Lets the agent check what it has already queued and hasn't been signed yet.
// ---------------------------------------------------------------------------

export const getPendingSigningRequestsTool = tool({
  description:
    "Check which transaction signing requests are currently waiting for the user to approve on their mobile app.",
  parameters: z.object({}),
  execute: async () => {
    const pending = await getPendingTxs();
    return {
      count: pending.length,
      pending: pending.map((tx) => ({
        tx_id: tx.tx_id,
        from_token: tx.from_token,
        to_token: tx.to_token,
        amount: Number(tx.amount),
        expires_at: tx.expires_at,
      })),
    };
  },
});
