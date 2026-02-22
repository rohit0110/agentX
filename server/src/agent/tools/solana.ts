import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "crypto";

// Phase 1: mock Solana tools — hardcoded prices and fake tx payloads.
// Phase 4 will replace with real Helius / Jupiter calls.

const MOCK_PRICES: Record<string, number> = {
  SOL: 185.42,
  USDC: 1.0,
  JUP: 1.23,
  BONK: 0.000038,
};

export const getSolanaPriceTool = tool({
  description:
    "Get the current price of a Solana token in USD. Supported tokens: SOL, USDC, JUP, BONK.",
  parameters: z.object({
    tokenSymbol: z
      .string()
      .toUpperCase()
      .describe("Token symbol, e.g. SOL, USDC, JUP, BONK"),
  }),
  execute: async ({ tokenSymbol }) => {
    const symbol = tokenSymbol.toUpperCase();
    const price = MOCK_PRICES[symbol];
    console.log(`[tool:getSolanaPrice] symbol=${symbol} price=${price}`);
    if (price === undefined) {
      return { symbol, price: null, error: `Unknown token: ${symbol}` };
    }
    return { symbol, price, currency: "USD", source: "mock" };
  },
});

export const buildMockSwapTxTool = tool({
  description:
    "Build a mock Solana swap transaction payload. Returns a fake base64 transaction ready for signing.",
  parameters: z.object({
    fromToken: z.string().describe("Source token symbol, e.g. SOL"),
    toToken: z.string().describe("Destination token symbol, e.g. USDC"),
    amount: z.number().positive().describe("Amount of fromToken to swap"),
    description: z.string().describe("Human-readable description of this trade"),
  }),
  execute: async ({ fromToken, toToken, amount, description }) => {
    const txId = randomUUID();
    // Fake base64 payload — in Phase 2 this will be a real serialised transaction.
    const mockBase64 = Buffer.from(
      JSON.stringify({ txId, fromToken, toToken, amount, description, ts: Date.now() })
    ).toString("base64");

    console.log(
      `[tool:buildMockSwapTx] ${amount} ${fromToken} → ${toToken} txId=${txId}`
    );

    return {
      txId,
      fromToken,
      toToken,
      amount,
      description,
      payload: mockBase64,
      status: "pending_signature",
    };
  },
});
