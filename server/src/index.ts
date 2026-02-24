import "dotenv/config";
import { initDb } from "./db/database";
import { buildServer } from "./server";
import { startPriceMonitor } from "./jobs/priceMonitor";

const PORT = Number(process.env.PORT ?? 8080);
const PRICE_MONITOR_INTERVAL_MS = Number(
  process.env.PRICE_MONITOR_INTERVAL_MS ?? 30_000
);

async function main() {
  await initDb();

  const server = await buildServer();

  await server.listen({ host: "0.0.0.0", port: PORT });
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);

  // Start the price monitoring loop after the server is up
  startPriceMonitor(PRICE_MONITOR_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[server] fatal", err);
  process.exit(1);
});
