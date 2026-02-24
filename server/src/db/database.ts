import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id  TEXT PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id          BIGSERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(session_id),
      role        TEXT NOT NULL CHECK (role IN ('user', 'agent')),
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Price alerts set by the user (or agent) — monitor and trigger when hit
  await sql`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id            BIGSERIAL PRIMARY KEY,
      session_id    TEXT,
      token         TEXT NOT NULL,
      target_price  NUMERIC NOT NULL,
      direction     TEXT NOT NULL CHECK (direction IN ('above', 'below')),
      from_token    TEXT NOT NULL,
      to_token      TEXT NOT NULL,
      amount        NUMERIC NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'triggered', 'cancelled')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Transactions built from triggered alerts — awaiting mobile wallet signature
  await sql`
    CREATE TABLE IF NOT EXISTS pending_txs (
      tx_id       TEXT PRIMARY KEY,
      alert_id    BIGINT REFERENCES price_alerts(id),
      from_token  TEXT NOT NULL,
      to_token    TEXT NOT NULL,
      amount      NUMERIC NOT NULL,
      payload     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending_signature'
                    CHECK (status IN ('pending_signature', 'signed', 'rejected', 'expired')),
      signature   TEXT,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Expo push tokens registered by mobile devices for background notifications
  await sql`
    CREATE TABLE IF NOT EXISTS devices (
      id          BIGSERIAL PRIMARY KEY,
      push_token  TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("[db] Schema ready");
}
