import { tool } from "ai";
import { z } from "zod";
import { currentPrices } from "../../jobs/priceMonitor";
import { createAlert, createPendingTx, getPendingTxs, getWalletAddress } from "../../db/alertsDb";
import { clientRegistry } from "../../ws/clientRegistry";
import { buildJupiterSwapTx } from "../../solana/buildTx";
import { sendPushToDevices } from "../../notifications/expoPush";

// Only these two tokens are supported for swaps
const SUPPORTED_TOKENS = ["SOL", "USDC"] as const;
type SupportedToken = typeof SUPPORTED_TOKENS[number];

// ---------------------------------------------------------------------------
// getSolanaPrice
// Reads from the shared price cache populated by the price monitor.
// ---------------------------------------------------------------------------

export const getSolanaPriceTool = tool({
  description:
    "Get the current price of SOL or USDC in USD.",
  parameters: z.object({
    tokenSymbol: z.enum(["SOL", "USDC"]).describe("Token symbol: SOL or USDC"),
  }),
  execute: async ({ tokenSymbol }) => {
    const price = currentPrices[tokenSymbol];
    console.log(`[tool:getSolanaPrice] ${tokenSymbol} = ${price}`);
    if (price === undefined) {
      return { symbol: tokenSymbol, price: null, error: `No price data for: ${tokenSymbol}` };
    }
    return { symbol: tokenSymbol, price, currency: "USD" };
  },
});

// ---------------------------------------------------------------------------
// createPriceAlert
// User tells the agent "buy SOL when it drops below $150" → agent calls this.
// Only SOL ↔ USDC swaps are supported.
// ---------------------------------------------------------------------------

export const createPriceAlertTool = tool({
  description:
    "Register a price alert. When SOL hits the target price the agent will be notified and can decide whether to queue a signing request. Only SOL→USDC and USDC→SOL swaps are supported.",
  parameters: z.object({
    token: z.literal("SOL").describe("Token to watch — only SOL is supported"),
    target_price: z.number().positive().describe("SOL price level that triggers the alert"),
    direction: z
      .enum(["above", "below"])
      .describe("Trigger when SOL price goes above or below target"),
    from_token: z.enum(["SOL", "USDC"]).describe("Token to sell when the alert fires"),
    to_token:   z.enum(["SOL", "USDC"]).describe("Token to buy when the alert fires"),
    amount: z.number().positive().describe("Amount of from_token to swap"),
  }),
  execute: async ({ token, target_price, direction, from_token, to_token, amount }) => {
    if (from_token === to_token) {
      return { success: false, error: "from_token and to_token must be different" };
    }

    const alert = await createAlert({
      token: token.toUpperCase(),
      target_price,
      direction,
      from_token,
      to_token,
      amount,
    });

    console.log(
      `[tool:createPriceAlert] alert=${alert.id} ${token} ${direction} ${target_price}`
    );

    return {
      success: true,
      alert_id: Number(alert.id),
      token,
      target_price,
      direction,
      from_token,
      to_token,
      amount,
    };
  },
});

// ---------------------------------------------------------------------------
// queueSigningRequest
// Builds a real Jupiter swap transaction and pushes it to the mobile app.
// Only SOL ↔ USDC swaps are supported.
// ---------------------------------------------------------------------------

export const queueSigningRequestTool = tool({
  description:
    "Send a transaction signing request to the user's mobile app. Call this ONLY after you have analysed the market and decided a trade should happen. Only SOL→USDC and USDC→SOL swaps are supported. The user sees your reason on their phone and can approve or reject it with their wallet.",
  parameters: z.object({
    from_token: z.enum(["SOL", "USDC"]).describe("Token to sell"),
    to_token:   z.enum(["SOL", "USDC"]).describe("Token to buy"),
    amount: z.number().positive().describe("Amount of from_token to swap"),
    reason: z
      .string()
      .describe(
        "One sentence shown to the user on their phone explaining why you recommend this trade. Be specific: include the price, the strategy, and what you expect. E.g. 'SOL dropped to $142 — executing your buy-the-dip strategy targeting $150 recovery.'"
      ),
  }),
  execute: async ({ from_token, to_token, amount, reason }) => {
    if (from_token === to_token) {
      return { success: false, error: "from_token and to_token must be different" };
    }

    const walletAddress = await getWalletAddress();
    if (!walletAddress) {
      return {
        success: false,
        error: "No wallet address registered. The user must open the app and connect their wallet first.",
      };
    }

    let serialized_tx: string;
    try {
      serialized_tx = await buildJupiterSwapTx({
        fromToken: from_token,
        toToken:   to_token,
        amount,
        userPublicKey: walletAddress,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tool:queueSigningRequest] Jupiter build failed: ${msg}`);
      return { success: false, error: `Failed to build swap transaction: ${msg}` };
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const tx = await createPendingTx({
      from_token,
      to_token,
      amount,
      payload: serialized_tx,
      expires_at: expiresAt,
    });

    const wsMsg = {
      type: "tx_signing_request" as const,
      payload: {
        tx_id: tx.tx_id,
        from_token,
        to_token,
        amount,
        serialized_tx,
        reason,
        trigger: {
          alert_id: 0,
          token: from_token,
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
      `[tool:queueSigningRequest] tx=${tx.tx_id} ${from_token}→${to_token} ${amount} wallet=${walletAddress} clients=${clientRegistry.size}`
    );

    return {
      success: true,
      tx_id: tx.tx_id,
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
