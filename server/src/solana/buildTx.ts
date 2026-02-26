// Mainnet token mint addresses
export const SOL_MINT  = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const TOKEN_DECIMALS: Record<string, number> = {
  SOL:  9,
  USDC: 6,
};

export function mintForToken(token: string): string {
  switch (token.toUpperCase()) {
    case "SOL":  return SOL_MINT;
    case "USDC": return USDC_MINT;
    default: throw new Error(`Unsupported token: ${token}. Only SOL and USDC are supported.`);
  }
}

function toSmallestUnit(amount: number, token: string): number {
  const decimals = TOKEN_DECIMALS[token.toUpperCase()];
  if (decimals === undefined) throw new Error(`Unknown token: ${token}`);
  return Math.round(amount * Math.pow(10, decimals));
}

/**
 * Build a Jupiter swap transaction for SOL ↔ USDC on mainnet.
 *
 * Calls the Jupiter v6 Quote API then the Swap API. Jupiter returns a
 * base64-encoded VersionedTransaction that is already structured for the
 * user's wallet — MWA on the mobile side deserializes, signs, then broadcasts.
 */
export async function buildJupiterSwapTx(params: {
  fromToken: string;   // "SOL" or "USDC"
  toToken:   string;   // "SOL" or "USDC"
  amount:    number;   // human-readable (e.g. 0.1 for 0.1 SOL)
  userPublicKey: string; // base58 wallet address — required by Jupiter
}): Promise<string> {
  const { fromToken, toToken, amount, userPublicKey } = params;

  const inputMint      = mintForToken(fromToken);
  const outputMint     = mintForToken(toToken);
  const amountSmallest = toSmallestUnit(amount, fromToken);

  // 1. Quote
  const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint",   inputMint);
  quoteUrl.searchParams.set("outputMint",  outputMint);
  quoteUrl.searchParams.set("amount",      String(amountSmallest));
  quoteUrl.searchParams.set("slippageBps", "50"); // 0.5% slippage

  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) {
    const body = await quoteRes.text();
    throw new Error(`Jupiter quote failed (${quoteRes.status}): ${body}`);
  }
  const quoteResponse = await quoteRes.json();

  // 2. Swap transaction
  const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol:          true,  // auto-wrap SOL → wSOL and unwrap wSOL → SOL
      dynamicComputeUnitLimit:   true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!swapRes.ok) {
    const body = await swapRes.text();
    throw new Error(`Jupiter swap tx build failed (${swapRes.status}): ${body}`);
  }

  const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };
  return swapTransaction; // base64-encoded VersionedTransaction ready for signing
}
