import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { triggerAtPrice, currentPrices } from "../jobs/priceMonitor";
import {
  createPendingTx,
  getTxById,
  getPendingTxs,
  refreshTx,
  resetTriggeredAlerts,
  clearPendingTxs,
  getWalletAddress,
} from "../db/alertsDb";
import { clientRegistry } from "../ws/clientRegistry";
import { buildJupiterSwapTx } from "../solana/buildTx";
import { sendPushToDevices } from "../notifications/expoPush";

const API_KEY = process.env.API_KEY ?? "change_me";

const TriggerBody = z.object({
  token: z.string().toUpperCase(),
  price: z.number().positive(),
});

/**
 * Simulation endpoints for testing the price-trigger → tx signing flow
 * without waiting for the real price monitor to tick.
 *
 *   POST /simulate/price-trigger  { token: "SOL", price: 140 }
 *     → instantly sets the mock SOL price to $140 and runs checkAlerts()
 *     → any active alert with target_price >= 140 (direction: below) fires
 *
 *   GET /simulate/prices
 *     → returns current mock prices
 */
const simulateRouter: FastifyPluginAsync = async (fastify) => {
  fastify.post("/simulate/price-trigger", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = TriggerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { token, price } = parsed.data;
    await triggerAtPrice(token, price);

    return reply.send({
      ok: true,
      token,
      simulated_price: price,
      message: `Mock price for ${token} set to ${price}; active alerts evaluated.`,
    });
  });

  fastify.get("/simulate/prices", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return reply.send({ prices: { ...currentPrices } });
  });

  /**
   * POST /simulate/push-tx
   * Directly builds a real devnet tx, stores it, and pushes it to the mobile
   * via WS + Expo push notification — no agent, no price alert needed.
   * Use this to test the notification-open → signing flow in isolation.
   */
  fastify.post("/simulate/push-tx", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const walletAddress = await getWalletAddress();
    if (!walletAddress) {
      return reply.code(400).send({ error: "No wallet address registered. Open the app and connect your wallet first." });
    }

    const serialized_tx = await buildJupiterSwapTx({
      fromToken: "SOL",
      toToken:   "USDC",
      amount:    0.01,
      userPublicKey: walletAddress,
    });
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const tx = await createPendingTx({
      from_token: "SOL",
      to_token:   "USDC",
      amount:     0.01,
      payload:    serialized_tx,
      expires_at: expiresAt,
    });

    const reason = "Test tx — tap to sign a 0.01 SOL → USDC swap on mainnet.";

    const wsMsg = {
      type: "tx_signing_request" as const,
      payload: {
        tx_id: tx.tx_id,
        from_token: "SOL",
        to_token: "USDC",
        amount: 0.01,
        serialized_tx,
        reason,
        trigger: {
          alert_id: 0,
          token: "SOL",
          target_price: 0,
          triggered_price: 0,
          direction: "below" as const,
        },
        expires_at: expiresAt.toISOString(),
      },
    };

    clientRegistry.broadcast(wsMsg);

    await sendPushToDevices("agentX: Sign Transaction", reason, {
      type: "tx_signing_request",
      tx_id: tx.tx_id,
    });

    console.log(
      `[simulate/push-tx] tx=${tx.tx_id} ws_clients=${clientRegistry.size}`
    );

    return reply.code(201).send({
      ok: true,
      tx_id: tx.tx_id,
      ws_clients_notified: clientRegistry.size,
      expires_at: expiresAt.toISOString(),
    });
  });

  /**
   * POST /simulate/resend-tx
   * Rebuilds the tx with a fresh devnet blockhash (old one expires in ~90s)
   * and re-pushes it to all connected WS clients.
   *
   * Body: { tx_id: string }  — specific tx
   * No body                  — resends ALL pending txs
   */
  fastify.post("/simulate/resend-tx", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { tx_id } = ((req.body as Record<string, unknown>) ?? {}) as { tx_id?: string };

    const txs = tx_id
      ? [await getTxById(tx_id)].filter(Boolean)
      : await getPendingTxs();

    if (txs.length === 0) {
      return reply.code(404).send({ error: "No matching tx found" });
    }

    const resent: string[] = [];

    const walletAddress = await getWalletAddress();
    if (!walletAddress) {
      return reply.code(400).send({ error: "No wallet address registered. Open the app and connect your wallet first." });
    }

    for (const tx of txs) {
      if (!tx) continue;

      // Rebuild with a fresh Jupiter quote + blockhash — old one expires after ~90s
      const freshPayload = await buildJupiterSwapTx({
        fromToken:     tx.from_token,
        toToken:       tx.to_token,
        amount:        Number(tx.amount),
        userPublicKey: walletAddress,
      });
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await refreshTx(tx.tx_id, freshPayload, expiresAt);

      clientRegistry.broadcast({
        type: "tx_signing_request",
        payload: {
          tx_id: tx.tx_id,
          from_token: tx.from_token,
          to_token: tx.to_token,
          amount: Number(tx.amount),
          serialized_tx: freshPayload,
          reason: "Resent by simulate endpoint for testing",
          trigger: {
            alert_id: Number(tx.alert_id),
            token: tx.from_token,
            target_price: 0,
            triggered_price: 0,
            direction: "below" as const,
          },
          expires_at: expiresAt.toISOString(),
        },
      });

      resent.push(tx.tx_id);
    }

    return reply.send({ ok: true, resent, clients: clientRegistry.size });
  });

  /**
   * POST /simulate/reset
   * Resets test state without wiping the DB:
   *   - flips all triggered alerts back to active
   *   - deletes all pending txs so the monitor can create fresh ones
   *
   * Run this between test cycles instead of restarting.
   */
  fastify.post("/simulate/reset", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    await clearPendingTxs();
    const alertsReset = await resetTriggeredAlerts();

    return reply.send({
      ok: true,
      alerts_reset: alertsReset,
      message: `${alertsReset} alert(s) back to active, pending txs cleared. Ready to trigger again.`,
    });
  });
};

export default simulateRouter;
