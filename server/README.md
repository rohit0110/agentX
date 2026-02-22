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

# 2. Set up env (from repo root)
cp server/.env.example server/.env
# Edit server/.env and fill in your ANTHROPIC_API_KEY

# 3. Install deps (from repo root — npm workspaces hoists everything here)
npm install

# 4. Start the server
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

---

### REST

#### `GET /health`
No auth required.

**Response:**
```json
{ "ok": true, "uptime": 42.3 }
```

---

#### `POST /agent/prompt`
Enqueue a prompt for the agent. The agent streams its response via WebSocket.

**Request body:**
```json
{
  "prompt": "What is the price of SOL?",
  "session_id": "optional-uuid"
}
```

**Response `202`:**
```json
{ "session_id": "a1b2c3..." }
```

Connect to `WS /ws` to receive streaming output for this `session_id`.

---

#### `GET /agent/history`
Returns all messages across all sessions, ordered by time.

**Response:**
```json
{
  "messages": [
    {
      "id": 1,
      "session_id": "a1b2c3...",
      "role": "user",
      "content": "What is the price of SOL?",
      "created_at": "2026-02-22T12:00:00Z"
    },
    {
      "id": 2,
      "session_id": "a1b2c3...",
      "role": "agent",
      "content": "SOL is currently trading at $185.42.",
      "created_at": "2026-02-22T12:00:02Z"
    }
  ]
}
```

---

### WebSocket — `GET /ws`

Connect with `X-Api-Key` header. All agent activity streams here.

#### Client → Server

```jsonc
// Send a prompt
{ "type": "prompt", "payload": { "prompt": "Build me a SOL to USDC swap", "session_id": "optional" } }

// Keepalive
{ "type": "ping" }
```

#### Server → Client

```jsonc
// Streaming token from the agent
{ "type": "agent_delta",  "payload": { "session_id": "...", "text": "The " } }

// Agent finished — full response
{ "type": "agent_done",   "payload": { "session_id": "...", "text": "The price of SOL is $185.42." } }

// Agent is calling a tool
{ "type": "tool_call",    "payload": { "session_id": "...", "tool": "getSolanaPrice", "input": { "tokenSymbol": "SOL" } } }

// Tool returned a result
{ "type": "tool_result",  "payload": { "session_id": "...", "tool": "getSolanaPrice", "output": { "symbol": "SOL", "price": 185.42 } } }

// Error
{ "type": "error",        "payload": { "session_id": "...", "message": "Something went wrong" } }

// Keepalive reply
{ "type": "pong" }
```

**Typical flow for a swap request:**
```
→ { type: "prompt", payload: { prompt: "Build me a SOL to USDC swap for 1 SOL" } }
← { type: "tool_call",   payload: { tool: "getSolanaPrice", input: { tokenSymbol: "SOL" } } }
← { type: "tool_result", payload: { tool: "getSolanaPrice", output: { price: 185.42 } } }
← { type: "tool_call",   payload: { tool: "buildMockSwapTx", input: { ... } } }
← { type: "tool_result", payload: { tool: "buildMockSwapTx", output: { txId: "...", payload: "..." } } }
← { type: "agent_delta", payload: { text: "I've built " } }
← { type: "agent_delta", payload: { text: "a swap transaction..." } }
← { type: "agent_done",  payload: { text: "I've built a swap transaction for 1 SOL → USDC..." } }
```

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
# then type: {"type":"prompt","payload":{"prompt":"Build me a SOL to USDC swap"}}
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
| 2 | 🔲 | Mobile Wallet Adapter signing requests — agent builds real txs, sends to mobile for approval |
| 3 | 🔲 | Vault & offline fallback — device-key auth, vault keypair takes over when user is offline |
| 4 | 🔲 | Real market integration — Helius price feeds, Jupiter swap quotes |
| 5 | 🔲 | Hardening + SDK extraction — rate limiting, audit logs, publishable client SDK |
