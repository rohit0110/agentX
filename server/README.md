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
       ├── GET  /health        (no auth)
       ├── POST /agent/prompt  (X-Api-Key)
       ├── GET  /agent/history (X-Api-Key)
       └── WS   /ws            (X-Api-Key)
                │
                ▼
         AgentRunner (EventEmitter)
          serialised queue → streamText
                │
                ▼
        Claude (claude-sonnet-4-6)
                │
        ┌───────┴────────┐
        ▼                ▼
  filesystem tools   solana tools
  (readFile,         (getSolanaPrice,
   writeFile)         buildMockSwapTx)
                │
                ▼
          PostgreSQL
     (sessions, messages)
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

**Headers:**
```
X-Api-Key: <key>
```

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

### WebSocket — `GET /ws`

Connect with the `X-Api-Key` header. All agent activity for all sessions streams to every connected client.

**Connection:**
```
ws://localhost:8080/ws
Headers: X-Api-Key: <key>
```

If auth fails, the socket is closed immediately with code `1008 Policy Violation`.

---

#### Messages: Client → Server

All messages are JSON text frames.

---

##### `prompt` — send a prompt to the agent

```json
{
  "type": "prompt",
  "payload": {
    "prompt": "Build me a SOL to USDC swap for 1 SOL",
    "session_id": "optional-uuid"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"prompt"` | Yes | Message type |
| `payload.prompt` | string | Yes | The user's message to the agent |
| `payload.session_id` | string | No | Continue an existing session (conversation memory). Omit for a new conversation. |

The agent begins processing immediately. Streaming output arrives as `agent_delta` → `agent_done` frames.

---

##### `ping` — keepalive

```json
{ "type": "ping" }
```

Server replies with `{ "type": "pong" }`. Use this to keep the connection alive and detect disconnects.

---

#### Messages: Server → Client

All messages are JSON text frames.

---

##### `agent_delta` — streaming token

Fired for each text token as Claude generates its response. Concatenate these in order to build the full response progressively.

```json
{
  "type": "agent_delta",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "text": "Here's your swap summary"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Which conversation this belongs to |
| `text` | string | A token or short fragment of the response |

---

##### `agent_done` — response complete

Fired once when Claude has finished generating. Contains the full assembled response text (same content as all `agent_delta` frames concatenated).

```json
{
  "type": "agent_done",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "text": "Here's your swap summary:\n\n| Detail | Value |\n|---|---|\n| **From** | 1 SOL |..."
  }
}
```

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Which conversation this belongs to |
| `text` | string | Full response text. May contain markdown. |

> The mobile app should use `agent_delta` frames to show a live typing effect, then replace with the `agent_done` text once complete.

---

##### `tool_call` — agent is calling a tool

Fired when Claude decides to invoke a tool. Useful for showing "thinking…" or tool-specific UI states in the app.

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

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Which conversation this belongs to |
| `tool` | string | Tool name (see Tool Reference below) |
| `input` | object | Arguments passed to the tool |

---

##### `tool_result` — tool returned a value

Fired immediately after a tool finishes executing. Contains the full tool output.

```json
{
  "type": "tool_result",
  "payload": {
    "session_id": "4df6ab7a-b99b-4d95-8dd5-deef11d0aaeb",
    "tool": "getSolanaPrice",
    "output": {
      "symbol": "SOL",
      "price": 185.42,
      "currency": "USD",
      "source": "mock"
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Which conversation this belongs to |
| `tool` | string | Tool name |
| `output` | object | Tool return value (shape varies by tool — see Tool Reference) |

---

##### `error` — agent or server error

Fired if the agent encounters an unrecoverable error for a session.

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

#### Full WS Flow Example — Swap Request

```
→ { "type": "prompt", "payload": { "prompt": "Build me a SOL to USDC swap for 1 SOL" } }

← { "type": "agent_delta",  "payload": { "session_id": "...", "text": "Sure! Let me fetch" } }
← { "type": "agent_delta",  "payload": { "session_id": "...", "text": " the current SOL price..." } }

← { "type": "tool_call",    "payload": { "session_id": "...", "tool": "getSolanaPrice",   "input":  { "tokenSymbol": "SOL" } } }
← { "type": "tool_result",  "payload": { "session_id": "...", "tool": "getSolanaPrice",   "output": { "symbol": "SOL", "price": 185.42, "currency": "USD", "source": "mock" } } }

← { "type": "tool_call",    "payload": { "session_id": "...", "tool": "getSolanaPrice",   "input":  { "tokenSymbol": "USDC" } } }
← { "type": "tool_result",  "payload": { "session_id": "...", "tool": "getSolanaPrice",   "output": { "symbol": "USDC", "price": 1, "currency": "USD", "source": "mock" } } }

← { "type": "tool_call",    "payload": { "session_id": "...", "tool": "buildMockSwapTx", "input":  { "fromToken": "SOL", "toToken": "USDC", "amount": 1, "description": "Swap 1 SOL to USDC" } } }
← { "type": "tool_result",  "payload": { "session_id": "...", "tool": "buildMockSwapTx", "output": {
    "txId": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
    "fromToken": "SOL",
    "toToken": "USDC",
    "amount": 1,
    "description": "Swap 1 SOL to USDC",
    "payload": "<base64-encoded-transaction>",
    "status": "pending_signature"
  } } }

← { "type": "agent_delta",  "payload": { "session_id": "...", "text": "Here's your swap summary..." } }
← { "type": "agent_delta",  "payload": { "session_id": "...", "text": "..." } }
← { "type": "agent_done",   "payload": { "session_id": "...", "text": "<full response>" } }
```

---

## Tool Reference

These are the tools available to the agent in Phase 1. All are mocked — no real network calls are made.

### `getSolanaPrice`

Returns the current price of a Solana token in USD.

**Input:**
```json
{ "tokenSymbol": "SOL" }
```

| Field | Type | Description |
|---|---|---|
| `tokenSymbol` | string | Token symbol. Supported: `SOL`, `USDC`, `JUP`, `BONK` |

**Output:**
```json
{
  "symbol": "SOL",
  "price": 185.42,
  "currency": "USD",
  "source": "mock"
}
```

| Field | Type | Description |
|---|---|---|
| `symbol` | string | Uppercased token symbol |
| `price` | number \| null | Price in USD. `null` if token unknown. |
| `currency` | string | Always `"USD"` |
| `source` | string | `"mock"` in Phase 1, will be `"helius"` in Phase 4 |

**Hardcoded Phase 1 prices:**
| Token | Price |
|---|---|
| SOL | $185.42 |
| USDC | $1.00 |
| JUP | $1.23 |
| BONK | $0.000038 |

---

### `buildMockSwapTx`

Builds a mock Solana swap transaction. Returns a fake base64-encoded transaction payload ready for signing.

**Input:**
```json
{
  "fromToken": "SOL",
  "toToken": "USDC",
  "amount": 1,
  "description": "Swap 1 SOL to USDC"
}
```

| Field | Type | Description |
|---|---|---|
| `fromToken` | string | Source token symbol |
| `toToken` | string | Destination token symbol |
| `amount` | number | Amount of `fromToken` to swap (must be > 0) |
| `description` | string | Human-readable label for this trade |

**Output:**
```json
{
  "txId": "2e31b14f-1a42-4e91-8ffc-216e3f16c70d",
  "fromToken": "SOL",
  "toToken": "USDC",
  "amount": 1,
  "description": "Swap 1 SOL to USDC",
  "payload": "eyJ0eElkIjoiMmUzMWIxNG...",
  "status": "pending_signature"
}
```

| Field | Type | Description |
|---|---|---|
| `txId` | string (UUID) | Unique ID for this transaction |
| `fromToken` | string | Source token |
| `toToken` | string | Destination token |
| `amount` | number | Amount being swapped |
| `description` | string | Human-readable label |
| `payload` | string (base64) | Serialized transaction bytes. In Phase 1 this is a base64-encoded JSON blob. In Phase 2+ this will be a real Solana transaction the mobile app passes to MWA for signing. |
| `status` | string | Always `"pending_signature"` — the mobile app must sign and submit |

> **Phase 2 note:** The `payload` field is what the mobile app will hand to Mobile Wallet Adapter (`signAndSendTransaction`). The shape of the output object is intentionally stable — only the `payload` contents change from mock to real.

---

### `readFile` *(mock)*

Reads a file from the filesystem. Phase 1 returns a canned string.

**Input:** `{ "path": "/some/file.txt" }`
**Output:** `{ "path": "/some/file.txt", "content": "[mock] Contents..." }`

---

### `writeFile` *(mock)*

Writes content to a file. Phase 1 does nothing.

**Input:** `{ "path": "/some/file.txt", "content": "hello" }`
**Output:** `{ "path": "/some/file.txt", "success": true, "message": "[mock] Would have written..." }`

---

## Mobile App Integration Guide

This section describes exactly what a React Native (Expo) app needs to implement to talk to this server.

### Connection Setup

```
Base URL:    http://<server-host>:8080     (REST)
WebSocket:   ws://<server-host>:8080/ws   (streaming)
Auth header: X-Api-Key: <your-api-key>
```

For local dev, replace `<server-host>` with your machine's LAN IP (e.g. `192.168.1.x`), not `localhost` — Android emulators and physical devices can't reach `localhost` on your Mac.

### Recommended Connection Pattern

1. **On app start:** fetch `GET /agent/history` to hydrate the chat log
2. **Open WS connection** and keep it open for the session lifetime
3. **Send prompts** via the WS `prompt` message (preferred) or `POST /agent/prompt` (fire-and-forget)
4. **Render streaming output** by appending `agent_delta.text` to the current message bubble
5. **Finalize the message** when `agent_done` fires — replace the streamed content with the full `text` (they are identical, but `agent_done` is the authoritative signal)
6. **Watch for `tool_call`** to show a "thinking / fetching price…" indicator
7. **Watch for `tool_result` where `tool === "buildMockSwapTx"`** — this is the signing request the app will present to the user in Phase 2

### Signing Request Detection (Phase 2 preview)

When the agent builds a swap, the mobile app will receive:

```json
{
  "type": "tool_result",
  "payload": {
    "tool": "buildMockSwapTx",
    "output": {
      "txId": "...",
      "payload": "<base64 transaction>",
      "status": "pending_signature"
    }
  }
}
```

The app should surface this as a confirmation card ("Agent wants to swap 1 SOL → USDC. Approve?"). On approval, pass `payload` to MWA's `signAndSendTransaction`. In Phase 1 the payload is fake — the UX flow can be wired up now without real signing.

### Session Management

- Use a single stable `session_id` UUID per user (generate once, persist in AsyncStorage)
- Pass it in every prompt so the agent maintains conversation context
- The same `session_id` works for both WS and REST prompts

### Error Handling

| Scenario | What to do |
|---|---|
| WS close code `1008` | API key wrong — show config error |
| `error` frame received | Show error message in chat, agent is still alive |
| WS disconnects unexpectedly | Reconnect with exponential backoff |
| `POST /agent/prompt` returns `401` | API key wrong |
| `POST /agent/prompt` returns `400` | Empty prompt — validate before sending |

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

# Fetch history
curl http://localhost:8080/agent/history \
  -H "X-Api-Key: change_me"

# Stream the agent live
npx wscat -c ws://localhost:8080/ws -H "X-Api-Key: change_me"
# then paste: {"type":"prompt","payload":{"prompt":"Build me a SOL to USDC swap for 1 SOL"}}
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
| 2 | 🔲 | Real signing requests — agent builds real Solana txs via Jupiter, mobile app signs with MWA |
| 3 | 🔲 | Vault & offline fallback — device-key auth, vault keypair takes over when user is offline |
| 4 | 🔲 | Real market integration — Helius price feeds, Jupiter swap quotes replace mocks |
| 5 | 🔲 | Hardening + SDK extraction — rate limiting, audit logs, publishable client SDK |
