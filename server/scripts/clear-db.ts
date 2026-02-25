/**
 * clear-db.ts — wipe all session/agent data from the DB.
 * Keeps the `devices` table (Expo push tokens should survive resets).
 *
 * Usage:
 *   npx tsx scripts/clear-db.ts
 */

import "dotenv/config";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Check your .env file.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function clearDb(): Promise<void> {
  console.log("Clearing DB...\n");

  // Order matters — respect FK constraints
  // postgres.js DELETE results expose .count (rows affected), no RETURNING needed
  const txs = await sql`DELETE FROM pending_txs`;
  console.log(`  pending_txs   cleared: ${txs.count} rows`);

  const alerts = await sql`DELETE FROM price_alerts`;
  console.log(`  price_alerts  cleared: ${alerts.count} rows`);

  const msgs = await sql`DELETE FROM messages`;
  console.log(`  messages      cleared: ${msgs.count} rows`);

  const sessions = await sql`DELETE FROM sessions`;
  console.log(`  sessions      cleared: ${sessions.count} rows`);

  const [{ n }] = await sql<{ n: string }[]>`SELECT COUNT(*) AS n FROM devices`;
  console.log(`\n  devices       kept:    ${n} push token(s)`);

  console.log("\nDone.");
}

clearDb()
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  })
  .finally(() => sql.end());
