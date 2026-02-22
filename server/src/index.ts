import "dotenv/config";
import { initDb } from "./db/database";
import { buildServer } from "./server";

const PORT = Number(process.env.PORT ?? 8080);

async function main() {
  await initDb();

  const server = await buildServer();

  await server.listen({ host: "0.0.0.0", port: PORT });
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
}

main().catch((err) => {
  console.error("[server] fatal", err);
  process.exit(1);
});
