import { randomUUID } from "crypto";
import { sql } from "./database";

// ---------------------------------------------------------------------------
// Types (raw rows from postgres.js — numerics come back as strings)
// ---------------------------------------------------------------------------

export interface AlertRow {
  id: string;
  session_id: string | null;
  token: string;
  target_price: string;
  direction: "above" | "below";
  from_token: string;
  to_token: string;
  amount: string;
  status: "active" | "triggered" | "cancelled";
  created_at: string;
}

export interface PendingTxRow {
  tx_id: string;
  alert_id: string;
  from_token: string;
  to_token: string;
  amount: string;
  payload: string;
  status: "pending_signature" | "signed" | "rejected" | "expired";
  signature: string | null;
  expires_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// price_alerts
// ---------------------------------------------------------------------------

export async function createAlert(params: {
  session_id?: string;
  token: string;
  target_price: number;
  direction: "above" | "below";
  from_token: string;
  to_token: string;
  amount: number;
}): Promise<AlertRow> {
  const [row] = await sql<AlertRow[]>`
    INSERT INTO price_alerts
      (session_id, token, target_price, direction, from_token, to_token, amount)
    VALUES
      (${params.session_id ?? null}, ${params.token}, ${params.target_price},
       ${params.direction}, ${params.from_token}, ${params.to_token}, ${params.amount})
    RETURNING *
  `;
  return row;
}

export async function getAlerts(status?: string): Promise<AlertRow[]> {
  if (status) {
    return sql<AlertRow[]>`SELECT * FROM price_alerts WHERE status = ${status} ORDER BY id DESC`;
  }
  return sql<AlertRow[]>`SELECT * FROM price_alerts ORDER BY id DESC`;
}

export async function getActiveAlerts(): Promise<AlertRow[]> {
  return sql<AlertRow[]>`SELECT * FROM price_alerts WHERE status = 'active' ORDER BY id ASC`;
}

export async function markAlertTriggered(id: string): Promise<void> {
  await sql`UPDATE price_alerts SET status = 'triggered' WHERE id = ${id}`;
}

export async function cancelAlert(id: string): Promise<boolean> {
  const result = await sql`
    UPDATE price_alerts SET status = 'cancelled'
    WHERE id = ${id} AND status = 'active'
    RETURNING id
  `;
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// pending_txs
// ---------------------------------------------------------------------------

export async function createPendingTx(params: {
  alert_id?: string;
  from_token: string;
  to_token: string;
  amount: number;
  payload: string;
  expires_at: Date;
}): Promise<PendingTxRow> {
  const tx_id = randomUUID();
  const alert_id = params.alert_id ?? null;
  const [row] = await sql<PendingTxRow[]>`
    INSERT INTO pending_txs
      (tx_id, alert_id, from_token, to_token, amount, payload, expires_at)
    VALUES
      (${tx_id}, ${alert_id}, ${params.from_token}, ${params.to_token},
       ${params.amount}, ${params.payload}, ${params.expires_at.toISOString()})
    RETURNING *
  `;
  return row;
}

export async function updateTxStatus(
  tx_id: string,
  status: "signed" | "rejected" | "expired",
  signature?: string
): Promise<void> {
  await sql`
    UPDATE pending_txs
    SET status = ${status}, signature = ${signature ?? null}
    WHERE tx_id = ${tx_id}
  `;
}

/** Fetch all txs still awaiting a signature and not yet expired */
export async function getPendingTxs(): Promise<PendingTxRow[]> {
  return sql<PendingTxRow[]>`
    SELECT * FROM pending_txs
    WHERE status = 'pending_signature' AND expires_at > NOW()
    ORDER BY created_at ASC
  `;
}

export async function getTxById(tx_id: string): Promise<PendingTxRow | null> {
  const [row] = await sql<PendingTxRow[]>`
    SELECT * FROM pending_txs WHERE tx_id = ${tx_id}
  `;
  return row ?? null;
}

/** Refresh a pending_tx with a new serialized payload and reset its expiry */
export async function refreshTx(
  tx_id: string,
  payload: string,
  expires_at: Date
): Promise<void> {
  await sql`
    UPDATE pending_txs
    SET payload = ${payload}, expires_at = ${expires_at.toISOString()}, status = 'pending_signature'
    WHERE tx_id = ${tx_id}
  `;
}

// ---------------------------------------------------------------------------
// Test helpers — reset state between test runs without wiping the DB
// ---------------------------------------------------------------------------

/** Flip triggered alerts back to active so they can fire again */
export async function resetTriggeredAlerts(): Promise<number> {
  const rows = await sql`
    UPDATE price_alerts SET status = 'active' WHERE status = 'triggered' RETURNING id
  `;
  return rows.length;
}

/** Remove pending/expired txs so the monitor can create fresh ones */
export async function clearPendingTxs(): Promise<void> {
  await sql`DELETE FROM pending_txs`;
}

// ---------------------------------------------------------------------------
// devices (Expo push tokens)
// ---------------------------------------------------------------------------

export async function registerDevice(push_token: string): Promise<void> {
  await sql`
    INSERT INTO devices (push_token)
    VALUES (${push_token})
    ON CONFLICT (push_token) DO NOTHING
  `;
}

export async function getDevicePushTokens(): Promise<string[]> {
  const rows = await sql<{ push_token: string }[]>`SELECT push_token FROM devices`;
  return rows.map((r) => r.push_token);
}
