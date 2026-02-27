# agentX

A proof-of-concept demonstrating real-time communication between an Android mobile app and a long-running LLM agent doing Solana trading.

The user prompts a trading strategy in plain English → the AI agent reasons over live Solana market prices → builds real Jupiter swap transactions → pushes them to the mobile app → the user approves with Mobile Wallet Adapter.

Inspired by [`idea.md`](./idea.md): _"Build a PoC that demonstrates a communication channel between an Android mobile app and an LLM-powered agent."_

---

## Why Claude instead of OpenClaw

The original idea referenced OpenClaw. After evaluation, Claude was a better fit for this PoC:

- **Native tool-calling** — structured tool definitions + streaming work out of the box with Anthropic's API
- **Reliable multi-step reasoning** — the agent can chain `getSolanaPrice` → `createPriceAlert` → `queueSigningRequest` across multiple turns without brittle prompt engineering
- **Faster iteration** — no plugin system to configure; the agent is just a TypeScript function

The core communication pattern from `idea.md` is preserved: agent sends signing requests to the app, user approves with MWA.

---

## Architecture

```
┌─────────────────────────────────────┐
│           Android App (Expo)        │
│                                     │
│  Chat UI ←→ AgentProvider (WS/REST) │
│                     ↑               │
│           AgentTxModal (MWA sign)   │
└────────────────┬────────────────────┘
                 │  WebSocket + REST
                 │  X-Api-Key auth
┌────────────────▼────────────────────┐
│        agentX Server (Node.js)      │
│                                     │
│  Fastify HTTP + WS                  │
│       │                             │
│  AgentRunner ──→ Claude Sonnet 4.6  │
│       │              │              │
│       │         ┌────┴────┐         │
│       │    getSolanaPrice │         │
│       │    createPriceAlert         │
│       │    queueSigningRequest      │
│       │    getPendingSigningReqs    │
│       │                             │
│  Price Monitor (30s poll)           │
│  ──→ checkAlerts() on price tick    │
│                                     │
│  Jupiter API (mainnet swap quotes)  │
│  Expo Push (background wake)        │
│  PostgreSQL (sessions, alerts, txs) │
└─────────────────────────────────────┘
```

---

## Monorepo Structure

```
agentX/
├── package.json          # npm workspaces root
├── tsconfig.base.json
├── idea.md               # original brief
├── server/               # npm workspace — Node.js AI agent server
│   └── README.md         # ← detailed server docs
└── mobile/               # Expo app — NOT part of npm workspaces
    └── README.md         # ← detailed mobile docs
```

`server/` is an npm workspace — `npm install` from the root installs everything into the root `node_modules/`.

`mobile/` is a standalone Expo project. Run `npm install` inside `mobile/` separately.

---

## Quick Start

### Start the server

```bash
# Prerequisites: Node.js 22+, Docker (for Postgres)

# 1. Start Postgres
docker run -d --name agentx-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16

# 2. Create the database
psql postgres://postgres:postgres@localhost:5432/postgres \
  -c "CREATE DATABASE agentx;"

# 3. Configure env
cp server/.env.example server/.env
# Edit server/.env — set ANTHROPIC_API_KEY at minimum

# 4. Install + run
npm install
npm run dev
# → http://localhost:8080
```

See [`server/README.md`](./server/README.md) for full API reference, Railway deploy guide, and environment variables.

### Run the mobile app

```bash
cd mobile
npm install
# Edit constants/agent-config.ts — set server IP + API key
npx expo prebuild --clean
npx expo run:android
```

See [`mobile/README.md`](./mobile/README.md) for push notification setup, MWA configuration, and the full signing flow.

---

## Phase Roadmap

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ | Server + AI agent + REST/WS API |
| 2 | ✅ | Real Jupiter mainnet swaps, price-triggered alerts, Expo push notifications, MWA signing |
| 3 | 🔲 | Vault & offline fallback — device-key auth, vault keypair takes over when user is offline |
| 4 | 🔲 | Real market integration — Helius price feeds replace polling |
| 5 | 🔲 | Hardening + SDK extraction — rate limiting, audit logs, publishable client SDK |
