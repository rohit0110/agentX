import { getActiveAlerts, markAlertTriggered } from "../db/alertsDb";
import { agentRunner } from "../agent/AgentRunner";

// ---------------------------------------------------------------------------
// Live price cache — populated from CoinGecko on each tick.
// Falls back to last known value if the API is unavailable.
// Phase 4: swap for Helius or a dedicated price oracle.
// ---------------------------------------------------------------------------

export const currentPrices: Record<string, number> = {
  SOL:  185.42,
  USDC: 1.0,
  JUP:  1.23,
  BONK: 0.000038,
};

const COINGECKO_IDS: Record<string, string> = {
  SOL:  "solana",
  USDC: "usd-coin",
  JUP:  "jupiter-exchange-solana",
  BONK: "bonk",
};

const COINGECKO_PRICE_API = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(COINGECKO_IDS).join(",")}&vs_currencies=usd`;

const PRICE_FETCH_INTERVAL_MS = Number(process.env.PRICE_FETCH_INTERVAL_MS ?? 60_000);
let lastPriceFetch = 0;

async function fetchLivePrices(): Promise<void> {
  const key = process.env.COINGECKO_API_KEY;
  const url = COINGECKO_PRICE_API;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["x-cg-demo-api-key"] = key;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    console.warn("[priceMonitor] CoinGecko fetch failed (network), using cached prices:", err);
    return;
  }

  if (res.status === 429) {
    console.warn("[priceMonitor] CoinGecko rate-limited, using cached prices");
    return;
  }

  if (!res.ok) {
    console.warn(`[priceMonitor] CoinGecko returned ${res.status}, using cached prices`);
    return;
  }

  const data = (await res.json()) as Record<string, { usd: number }>;

  for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
    if (data[cgId]?.usd !== undefined) {
      currentPrices[symbol] = data[cgId].usd;
    }
  }

  console.log(
    `[priceMonitor] Prices refreshed — SOL $${currentPrices.SOL?.toFixed(2)} | JUP $${currentPrices.JUP?.toFixed(4)} | BONK $${currentPrices.BONK?.toFixed(8)}`
  );
}

// ---------------------------------------------------------------------------
// Core: check all active alerts against current prices.
// Hands off to the agent to decide — no tx is built here.
// ---------------------------------------------------------------------------

export async function checkAlerts(): Promise<void> {
  const alerts = await getActiveAlerts();
  if (alerts.length === 0) return;

  for (const alert of alerts) {
    const price = currentPrices[alert.token.toUpperCase()];
    if (price === undefined) {
      console.warn(`[priceMonitor] No price for token: ${alert.token}`);
      continue;
    }

    const target = Number(alert.target_price);
    const triggered =
      (alert.direction === "above" && price >= target) ||
      (alert.direction === "below" && price <= target);

    if (!triggered) continue;

    // Mark immediately so concurrent ticks don't double-fire
    await markAlertTriggered(alert.id);

    console.log(
      `[priceMonitor] Alert ${alert.id} triggered — ${alert.token} at $${price.toFixed(4)} (target: ${alert.direction} $${target}). Handing off to agent.`
    );

    const prompt =
      `[SYSTEM — price alert triggered]\n` +
      `Token: ${alert.token}\n` +
      `Current price: $${price.toFixed(4)}\n` +
      `User's target: price goes ${alert.direction} $${target}\n` +
      `Configured trade: swap ${alert.amount} ${alert.from_token} → ${alert.to_token}\n\n` +
      `Verify the current price, assess whether this is a good moment to execute, ` +
      `and if you decide to proceed call queueSigningRequest with a reason the user ` +
      `will see on their phone. If you decide not to proceed, explain why briefly.`;

    agentRunner.enqueue(prompt, `alert_${alert.id}`);
  }
}

// ---------------------------------------------------------------------------
// Exported for the simulate endpoint
// ---------------------------------------------------------------------------

export async function triggerAtPrice(token: string, price: number): Promise<void> {
  currentPrices[token.toUpperCase()] = price;
  await checkAlerts();
}

// ---------------------------------------------------------------------------
// Start the polling loop
// ---------------------------------------------------------------------------

export function startPriceMonitor(intervalMs = 30_000): NodeJS.Timeout {
  console.log(`[priceMonitor] Starting — interval=${intervalMs}ms`);

  // Fetch live prices immediately so the cache is warm before the first tick
  lastPriceFetch = Date.now();
  fetchLivePrices().catch((err) =>
    console.error("[priceMonitor] Initial price fetch failed:", err)
  );

  const handle = setInterval(async () => {
    try {
      const now = Date.now();
      if (now - lastPriceFetch >= PRICE_FETCH_INTERVAL_MS) {
        lastPriceFetch = now;
        await fetchLivePrices();
      }
      await checkAlerts();
    } catch (err) {
      console.error("[priceMonitor] tick error", err);
    }
  }, intervalMs);

  return handle;
}
