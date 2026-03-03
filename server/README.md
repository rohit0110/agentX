# agentX — Server

Long-running AI agent server for the agentX Solana trading assistant. Exposes a REST API and WebSocket endpoint so clients can interact with the agent in real time — watching tool calls stream in, seeing the agent reason, and receiving the final response.

---

## Architecture

```
Client (REST / WS)
       │
       ▼
  Fastify (HTTP + WS)
       │
       ├── GET    /health                (no auth)
       ├── POST   /agent/prompt          (X-Api-Key)
       ├── GET    /agent/history         (X-Api-Key)
       ├── POST   /orders/alert          (X-Api-Key)
       ├── GET    /orders/alerts         (X-Api-Key)
       ├── DELETE /orders/alerts/:id     (X-Api-Key)
       ├── POST   /device/register       (X-Api-Key)
       └── WS     /ws                    (X-Api-Key)
                │
                ▼
         AgentRunner (EventEmitter)
          serialised queue → streamText
                │
                ▼
        Claude (claude-sonnet-4-6)
                │
        ┌───────┴───────────────────┐
        ▼                           ▼
  getSolanaPrice           createPriceAlert
  queueSigningRequest      getPendingSigningRequests
                │
       ┌────────┼────────────┐
       ▼        ▼            ▼
  Jupiter    Expo Push   PostgreSQL
  (mainnet    (FCM via   (sessions,
   swaps)      Expo)      alerts, txs)
                │
       Price Monitor (60s CoinGecko poll)
       → checkAlerts() → queueSigningRequest
```

---

## Running Locally

**Prerequisites:** Node.js 22+, Docker (for Postgres)

```bash
# 1. Start Postgres (run from anywhere — Docker doesn't care about your cwd)
docker run -d \
  --name agentx-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16

# 2. Create the database (once)
psql postgres://postgres:postgres@localhost:5432/postgres -c "CREATE DATABASE agentx;"

# 3. Set up env (from repo root)
cp server/.env.example server/.env
# Edit server/.env — at minimum set ANTHROPIC_API_KEY

# 4. Install deps (from repo root — npm workspaces hoists everything here)
npm install

# 5. Start the server
npm run dev
```

The server starts at **http://localhost:8080**.

> **Note on `node_modules`:** npm workspaces hoists all packages to the root `node_modules/` — there is no separate `server/node_modules`. This is expected.

---

## API Reference

### Authentication

All routes except `GET /health` require the header:

```
X-Api-Key: <value of API_KEY env var>
```

If the key is missing or wrong, the server returns `401 { "error": "Unauthorized" }`.
For WebSocket, the connection is closed immediately with code `1008`.

---

### REST

#### `GET /health`

No auth required. Use this for uptime checks and Railway health checks.

**Response `200`:**
```json
{ "ok": true, "uptime": 42.3 }
```

---

#### `POST /agent/prompt`

Enqueue a prompt for the agent. Returns immediately with a `session_id`. The agent runs asynchronously — connect to `WS /ws` to receive streaming output.

**Headers:**
```
X-Api-Key: <key>
Content-Type: application/json
```

**Request body:**
```json
{
  "prompt": "What is the price of SOL?",
  "session_id": "optional-uuid-to-continue-a-conversation"
}
```

- `prompt` — required, non-empty string
- `session_id` — optional. If omitted, a new UUID is generated. Pass the same `session_id` across calls to maintain conversation context (the agent sees prior messages as history).

**Response `202`:**
```json
{ "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb" }
```

**Response `400`** (invalid body):
```json
{
  "error": "Invalid request",
  "details": [{ "code": "too_small", "path": ["prompt"], "message": "String must contain at least 1 character(s)" }]
}
```

**Response `401`:** `{ "error": "Unauthorized" }`

---

#### `GET /agent/history`

Returns all messages across all sessions, ordered oldest-first. Useful for hydrating a chat UI on app launch.

**Response `200`:**
```json
{
  "messages": [
    {
      "id": 1,
      "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
      "role": "user",
      "content": "What is the price of SOL?",
      "created_at": "2026-02-22T21:09:00.000Z"
    },
    {
      "id": 2,
      "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
      "role": "agent",
      "content": "SOL is currently trading at $185.42 USD.",
      "created_at": "2026-02-22T21:09:03.000Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | number | Auto-incrementing row ID, use for ordering |
| `session_id` | string | UUID grouping messages into a conversation |
| `role` | `"user"` \| `"agent"` | Who sent this message |
| `content` | string | Full message text (agent messages may contain markdown) |
| `created_at` | ISO 8601 string | UTC timestamp |

---

#### `POST /orders/alert`

Create a price alert. When the SOL price crosses the target, the server automatically builds a Jupiter swap transaction and pushes a `tx_signing_request` to connected mobile clients.

**Request body:**
```json
{
  "token": "SOL",
  "target_price": 150.00,
  "direction": "below",
  "from_token": "SOL",
  "to_token": "USDC",
  "amount": 1.0
}
```

| Field | Type | Description |
|---|---|---|
| `token` | string | Token to watch — currently only `SOL` is supported |
| `target_price` | number | Price level that triggers the alert |
| `direction` | `"above"` \| `"below"` | Fire when price goes above or below target |
| `from_token` | `"SOL"` \| `"USDC"` | Token to sell when alert fires |
| `to_token` | `"SOL"` \| `"USDC"` | Token to buy when alert fires |
| `amount` | number | Amount of `from_token` to swap |

**Response `201`:**
```json
{
  "alert_id": 3,
  "token": "SOL",
  "target_price": 150.00,
  "direction": "below",
  "from_token": "SOL",
  "to_token": "USDC",
  "amount": 1.0,
  "status": "active",
  "created_at": "2026-02-27T10:00:00.000Z"
}
```

---

#### `GET /orders/alerts`

List price alerts. Optionally filter by status.

**Query params:** `?status=active` (optional — values: `active`, `triggered`, `cancelled`)

**Response `200`:**
```json
[
  {
    "alert_id": 3,
    "token": "SOL",
    "target_price": 150.00,
    "direction": "below",
    "from_token": "SOL",
    "to_token": "USDC",
    "amount": 1.0,
    "status": "active",
    "created_at": "2026-02-27T10:00:00.000Z"
  }
]
```

---

#### `DELETE /orders/alerts/:id`

Cancel an active alert.

**Response `200`:** `{ "ok": true, "alert_id": 3 }`

**Response `404`:** `{ "error": "Alert not found or already inactive" }`

---

#### `POST /device/register`

Register a mobile device's Expo push token. Call this on every app launch. Also accepts an optional wallet address (used by the server when building swap transactions).

**Request body:**
```json
{
  "push_token": "ExponentPushToken[xxxxxx]",
  "wallet_address": "So11111111111111111111111111111111111111112"
}
```

| Field | Type | Description |
|---|---|---|
| `push_token` | string | Expo push token from `expo-notifications` |
| `wallet_address` | string | Optional. Solana wallet public key for building Jupiter swap txs |

**Response `201`:** `{ "ok": true }`

---

#### `POST /simulate/price-trigger` *(testing only)*

Instantly set a mock token price and run `checkAlerts()`. Use this during development to trigger the alert → swap → signing flow without waiting for the real price monitor.

**Request body:**
```json
{ "token": "SOL", "price": 140 }
```

**Response `200`:**
```json
{
  "ok": true,
  "token": "SOL",
  "simulated_price": 140,
  "message": "Mock price for SOL set to 140; active alerts evaluated."
}
```

---

#### `GET /simulate/prices` *(testing only)*

Return the current prices held in the price monitor cache.

**Response `200`:** `{ "prices": { "SOL": 185.42, "USDC": 1.0 } }`

---

#### `POST /simulate/push-tx` *(testing only)*

Directly build a real Jupiter swap tx (0.01 SOL → USDC) and push it to all connected WS clients + Expo push, bypassing the agent and alert system entirely. Use this to test the notification → signing flow in isolation.

**Response `201`:**
```json
{
  "ok": true,
  "tx_id": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
  "ws_clients_notified": 1,
  "expires_at": "2026-02-27T10:05:00.000Z"
}
```

---

#### `POST /simulate/resend-tx` *(testing only)*

Rebuild a pending tx with a fresh Jupiter quote and re-push it. Solana transactions expire after ~90 seconds — use this when you need to re-present a signing request after it expired.

**Request body:** `{ "tx_id": "..." }` (omit to resend all pending txs)

---

#### `POST /simulate/reset` *(testing only)*

Reset test state: flips triggered alerts back to `active` and deletes pending txs. Run between test cycles instead of restarting.

---

### WebSocket — `GET /ws`

Connect with the `X-Api-Key` header. All agent activity for all sessions streams to every connected client.

**Connection:**
```
ws://localhost:8080/ws
Headers: X-Api-Key: <key>
```

If auth fails, the socket is closed immediately with code `1008 Policy Violation`.

On reconnect, the server re-delivers any non-expired pending signing requests automatically.

---

#### Messages: Client → Server

All messages are JSON text frames.

---

##### `prompt` — send a prompt to the agent

```json
{
  "type": "prompt",
  "payload": {
    "prompt": "Buy SOL when it drops below $150",
    "session_id": "optional-uuid"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"prompt"` | Yes | Message type |
| `payload.prompt` | string | Yes | The user's message to the agent |
| `payload.session_id` | string | No | Continue an existing session. Omit for a new conversation. |

---

##### `tx_signed` — transaction was approved and sent by the wallet

```json
{
  "type": "tx_signed",
  "payload": {
    "tx_id": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
    "signature": "5Uf8X..."
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tx_id` | string | The `tx_id` from the signing request |
| `signature` | string | Base58-encoded Solana transaction signature |

---

##### `tx_rejected` — user declined the signing request

```json
{
  "type": "tx_rejected",
  "payload": {
    "tx_id": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
    "reason": "User dismissed"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tx_id` | string | The `tx_id` from the signing request |
| `reason` | string | Optional. Human-readable rejection reason. |

---

##### `ping` — keepalive

```json
{ "type": "ping" }
```

Server replies with `{ "type": "pong" }`.

---

#### Messages: Server → Client

All messages are JSON text frames.

---

##### `agent_delta` — streaming token

Fired for each text token as Claude generates its response. Concatenate these to show a live typing effect.

```json
{
  "type": "agent_delta",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "text": "Setting up your price alert..."
  }
}
```

---

##### `agent_done` — response complete

Fired once when Claude finishes generating. Contains the full assembled response (identical to all `agent_delta` frames concatenated).

```json
{
  "type": "agent_done",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "text": "Done! I've set a price alert: I'll queue a swap of 1 SOL → USDC when SOL drops below $150."
  }
}
```

> Use `agent_delta` frames for the live typing effect, then replace with `agent_done` text as the authoritative final response.

---

##### `tool_call` — agent is calling a tool

```json
{
  "type": "tool_call",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "tool": "getSolanaPrice",
    "input": { "tokenSymbol": "SOL" }
  }
}
```

---

##### `tool_result` — tool returned a value

```json
{
  "type": "tool_result",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "tool": "getSolanaPrice",
    "output": { "symbol": "SOL", "price": 185.42, "currency": "USD" }
  }
}
```

---

##### `tx_signing_request` — agent has queued a swap for the user to sign

Pushed to all connected clients whenever the agent calls `queueSigningRequest` or a price alert fires. The mobile app should surface this as a confirmation modal.

```json
{
  "type": "tx_signing_request",
  "payload": {
    "tx_id": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
    "from_token": "SOL",
    "to_token": "USDC",
    "amount": 1.0,
    "serialized_tx": "<base64-encoded Jupiter v0 transaction>",
    "reason": "SOL dropped to $142 — executing your buy-the-dip strategy targeting $150 recovery.",
    "trigger": {
      "alert_id": 3,
      "token": "SOL",
      "target_price": 150.00,
      "triggered_price": 142.10,
      "direction": "below"
    },
    "expires_at": "2026-02-27T10:05:00.000Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tx_id` | string (UUID) | Unique ID for this signing request |
| `from_token` | string | Token being sold (`"SOL"` or `"USDC"`) |
| `to_token` | string | Token being bought |
| `amount` | number | Amount of `from_token` |
| `serialized_tx` | string (base64) | Serialized Jupiter v0 transaction. Pass directly to MWA `signAndSendTransaction`. |
| `reason` | string | Agent's one-line explanation shown to the user |
| `trigger.alert_id` | number | Alert that triggered this (0 if agent-initiated directly) |
| `trigger.token` | string | Token that was watched |
| `trigger.target_price` | number | Price level from the alert |
| `trigger.triggered_price` | number | Actual price when the alert fired |
| `trigger.direction` | `"above"` \| `"below"` | Alert direction |
| `expires_at` | ISO 8601 string | Client should refuse to sign after this time |

---

##### `error` — agent or server error

```json
{
  "type": "error",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "message": "Anthropic API rate limit exceeded"
  }
}
```

---

##### `pong` — keepalive reply

```json
{ "type": "pong" }
```

---

#### Full WS Flow Example — Agent-Initiated Swap

```
→ { "type": "prompt", "payload": { "prompt": "SOL looks cheap. Swap 0.5 SOL to USDC." } }

← { "type": "agent_delta",  "payload": { "session_id": "...", "text": "Let me check the price first..." } }

← { "type": "tool_call",   "payload": { "session_id": "...", "tool": "getSolanaPrice", "input": { "tokenSymbol": "SOL" } } }
← { "type": "tool_result", "payload": { "session_id": "...", "tool": "getSolanaPrice", "output": { "symbol": "SOL", "price": 142.10, "currency": "USD" } } }

← { "type": "tool_call",   "payload": { "session_id": "...", "tool": "queueSigningRequest",
     "input": { "from_token": "SOL", "to_token": "USDC", "amount": 0.5,
                "reason": "SOL is at $142 — below your target. Swapping 0.5 SOL to USDC to lock in." } } }
← { "type": "tool_result", "payload": { "session_id": "...", "tool": "queueSigningRequest",
     "output": { "success": true, "tx_id": "2e31b14f-...", "connected_clients": 1,
                 "message": "Signing request sent. The user will see: \"SOL is at $142...\"" } } }

← { "type": "tx_signing_request", "payload": {
      "tx_id": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
      "from_token": "SOL", "to_token": "USDC", "amount": 0.5,
      "serialized_tx": "<base64 Jupiter v0 tx>",
      "reason": "SOL is at $142 — below your target. Swapping 0.5 SOL to USDC to lock in.",
      "trigger": { "alert_id": 0, "token": "SOL", "target_price": 0, "triggered_price": 0, "direction": "below" },
      "expires_at": "2026-02-27T10:05:00.000Z"
   } }

← { "type": "agent_done", "payload": { "session_id": "...", "text": "Done! I've sent a signing request to your phone. SOL → USDC swap for 0.5 SOL. Approve it in the app." } }

  [user approves in mobile app via MWA]

→ { "type": "tx_signed", "payload": { "tx_id": "2e31b14f-...", "signature": "5Uf8X..." } }
```

---

## Tool Reference

These are the tools available to the agent. All use live mainnet data via the Jupiter API and price monitor cache.

### `getSolanaPrice`

Returns the current price of SOL or USDC from the price monitor cache (polled every 60 seconds from CoinGecko; falls back to last known value if rate-limited).

**Input:**
```json
{ "tokenSymbol": "SOL" }
```

| Field | Type | Description |
|---|---|---|
| `tokenSymbol` | `"SOL"` \| `"USDC"` | Token to query |

**Output:**
```json
{ "symbol": "SOL", "price": 185.42, "currency": "USD" }
```

---

### `createPriceAlert`

Register a price alert. When SOL crosses the target price, the server automatically builds a Jupiter swap transaction and pushes a `tx_signing_request` to the mobile app.

**Input:**
```json
{
  "token": "SOL",
  "target_price": 150.0,
  "direction": "below",
  "from_token": "SOL",
  "to_token": "USDC",
  "amount": 1.0
}
```

| Field | Type | Description |
|---|---|---|
| `token` | `"SOL"` | Token to watch (only SOL currently) |
| `target_price` | number | Price level that triggers the alert |
| `direction` | `"above"` \| `"below"` | Trigger when price goes above or below target |
| `from_token` | `"SOL"` \| `"USDC"` | Token to sell when alert fires |
| `to_token` | `"SOL"` \| `"USDC"` | Token to buy when alert fires |
| `amount` | number | Amount of `from_token` to swap |

**Output:**
```json
{ "success": true, "alert_id": 3, "token": "SOL", "target_price": 150.0, "direction": "below", "from_token": "SOL", "to_token": "USDC", "amount": 1.0 }
```

---

### `queueSigningRequest`

Build a real Jupiter mainnet swap transaction and push it to the user's mobile app immediately. Call this when the agent decides a trade should happen right now (as opposed to setting up a future price alert).

**Input:**
```json
{
  "from_token": "SOL",
  "to_token": "USDC",
  "amount": 0.5,
  "reason": "SOL dropped to $142 — executing your buy-the-dip strategy targeting $150 recovery."
}
```

| Field | Type | Description |
|---|---|---|
| `from_token` | `"SOL"` \| `"USDC"` | Token to sell |
| `to_token` | `"SOL"` \| `"USDC"` | Token to buy |
| `amount` | number | Amount of `from_token` to swap |
| `reason` | string | One sentence shown to the user on their phone explaining the trade |

**Output:**
```json
{ "success": true, "tx_id": "2e31b14f-...", "connected_clients": 1, "message": "Signing request sent. The user will see: \"...\"" }
```

The tool simultaneously:
1. Fetches a fresh Jupiter quote + builds a serialized v0 transaction
2. Stores the pending tx in Postgres
3. Broadcasts `tx_signing_request` over WebSocket to all connected clients
4. Sends an Expo push notification to wake the app if it's in the background

---

### `getPendingSigningRequests`

Check which signing requests are still awaiting user approval.

**Input:** *(none)*

**Output:**
```json
{
  "count": 1,
  "pending": [
    { "tx_id": "2e31b14f-...", "from_token": "SOL", "to_token": "USDC", "amount": 0.5, "expires_at": "2026-02-27T10:05:00.000Z" }
  ]
}
```

---

## Mobile App Integration Guide

### Connection Setup

```
Base URL:    http://<server-host>:8080     (REST)
WebSocket:   ws://<server-host>:8080/ws   (streaming)
Auth header: X-Api-Key: <your-api-key>
```

For local dev, replace `<server-host>` with your machine's LAN IP (e.g. `192.168.1.x`), not `localhost` — Android emulators and physical devices can't reach `localhost` on your Mac.

### Recommended Connection Pattern

1. **On app start:** call `POST /device/register` with your Expo push token and wallet address
2. **Fetch `GET /agent/history`** to hydrate the chat log
3. **Open WS connection** and keep it open for the session lifetime
4. **Send prompts** via the WS `prompt` message (preferred) or `POST /agent/prompt`
5. **Render streaming output** by appending `agent_delta.text` to the current message bubble
6. **Finalize the message** when `agent_done` fires — replace streamed content with the full `text`
7. **Watch for `tool_call`** to show a "thinking / fetching price…" indicator
8. **Watch for `tx_signing_request`** — present `AgentTxModal` with the trade details; on approval pass `serialized_tx` (base64) to MWA `signAndSendTransaction`; on completion send `tx_signed` back; on dismissal send `tx_rejected`

### Signing Request Flow

When the agent queues a swap (or a price alert fires), the mobile app receives a `tx_signing_request` WS message:

```json
{
  "type": "tx_signing_request",
  "payload": {
    "tx_id": "2e31b14f-...",
    "from_token": "SOL",
    "to_token": "USDC",
    "amount": 0.5,
    "serialized_tx": "<base64 Jupiter v0 transaction>",
    "reason": "Agent's explanation shown to user",
    "expires_at": "2026-02-27T10:05:00.000Z"
  }
}
```

1. Show a modal: "Agent wants to swap 0.5 SOL → USDC. [reason]. Approve?"
2. User taps **Sign & Send** → decode `serialized_tx` from base64 → pass to MWA `signAndSendTransaction`
3. On success: send `{ "type": "tx_signed", "payload": { "tx_id": "...", "signature": "<base58>" } }`
4. On rejection: send `{ "type": "tx_rejected", "payload": { "tx_id": "..." } }`
5. **Check `expires_at`** before signing — refuse if the current time is past expiry (Jupiter quotes expire ~90s after creation)

### Session Management

- Use a single stable `session_id` UUID per user (generate once, persist in AsyncStorage)
- Pass it in every prompt so the agent maintains conversation context
- The same `session_id` works for both WS and REST prompts

### Error Handling

| Scenario | What to do |
|---|---|
| WS close code `1008` | API key wrong — show config error |
| `error` frame received | Show error message in chat; agent is still alive |
| WS disconnects unexpectedly | Reconnect with exponential backoff; server re-delivers pending signing requests on reconnect |
| `tx_signing_request` past `expires_at` | Ignore and discard; a fresh one will arrive if the alert is still active |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP port to listen on |
| `API_KEY` | Yes | `change_me` | Secret sent by clients in `X-Api-Key` header |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude access |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `NODE_ENV` | No | `development` | `production` disables pretty-print logs |

---

## Quick Test

```bash
# Health (no auth)
curl http://localhost:8080/health

# Fire a prompt
curl -X POST http://localhost:8080/agent/prompt \
  -H "X-Api-Key: change_me" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is the current price of SOL?"}'
# → 202 { "session_id": "..." }

# Create a price alert
curl -X POST http://localhost:8080/orders/alert \
  -H "X-Api-Key: change_me" \
  -H "Content-Type: application/json" \
  -d '{"token":"SOL","target_price":150,"direction":"below","from_token":"SOL","to_token":"USDC","amount":1}'

# Simulate the alert firing
curl -X POST http://localhost:8080/simulate/price-trigger \
  -H "X-Api-Key: change_me" \
  -H "Content-Type: application/json" \
  -d '{"token":"SOL","price":140}'

# Stream the agent live (connect first, then paste the prompt)
npx wscat -c ws://localhost:8080/ws -H "X-Api-Key: change_me"
# → {"type":"prompt","payload":{"prompt":"Buy SOL when it drops below $150"}}
```

---

## Deploying to Railway

1. Push this repo to GitHub.
2. In [Railway](https://railway.app), click **New Project → Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects the `railway.json` build config.
4. Add the **Postgres** plugin: click **+ New** → **Database** → **PostgreSQL**. Railway injects `DATABASE_URL` automatically.
5. Set the following environment variables in Railway:
   - `API_KEY` — a strong random secret
   - `ANTHROPIC_API_KEY` — your Anthropic key
6. Click **Deploy**. Railway runs `npm run build` then `node dist/index.js`.
7. Visit the generated Railway URL — `GET /health` should return `{"ok":true}`.

No Volume needed — all state lives in Postgres.

---

## Phase Roadmap

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ | Server + AI agent + REST/WS API |
| 2 | ✅ | Real Jupiter mainnet swaps, price-triggered alerts, Expo push notifications, MWA signing |
| 3 | 🔲 | Vault & offline fallback — device-key auth, vault keypair takes over when user is offline |
| 4 | 🔲 | Real market integration — Helius price feeds replace polling |
| 5 | 🔲 | Hardening + SDK extraction — rate limiting, audit logs, publishable client SDK |
