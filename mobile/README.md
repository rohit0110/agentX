# agentX Mobile

React Native (Expo) mobile client for agentX. Connects to the agentX server via WebSocket and REST, handles wallet authentication via Mobile Wallet Adapter (MWA), and receives transaction signing requests from the AI agent.

## Prerequisites

- Android device or emulator with Google Play Services
- [Android Studio](https://developer.android.com/studio) with an emulator configured, or a physical Android device
- Node.js 22+
- The agentX server running (see `../server/README.md`)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the server connection

Edit `constants/agent-config.ts`:

```ts
export const AgentConfig = {
  apiUrl: 'http://<your-server-ip>:8080',  // 10.0.2.2 for Android emulator → host localhost
  wsUrl:  'ws://<your-server-ip>:8080/ws',
  apiKey: '<your API_KEY env var value>',
}
```

### 3. Prebuild and run

The app uses a custom dev client (not Expo Go) — a native build is required.

```bash
npx expo run:android
```

If you change `app.json` (package name, plugins, etc.), do a clean prebuild first:

```bash
npx expo prebuild --clean && npx expo run:android
```

## Push Notifications Setup

Push notifications use Expo's push service (relayed via FCM) to wake the app when a transaction signing request arrives while the app is closed.

### One-time EAS setup

```bash
# Log in
npx eas-cli login

# Link project (writes projectId into app.json automatically)
npx eas-cli init

# Upload FCM V1 credentials
npx eas-cli credentials
# → Android → Google Service Account → upload the service account JSON
#   (Firebase Console → Project Settings → Service Accounts → Generate new private key)
```

The app registers its Expo push token with the server at `POST /device/register` on every launch. No further configuration is needed.

## Architecture

```
MobileWalletProvider (Solana devnet)
  AuthProvider          — wallet connect/disconnect via MWA
    AgentProvider       — WebSocket + REST, message state, tx signing flow
      NotificationProvider — push token registration
      <screens>
```

### Transaction signing flow

1. Agent triggers a price alert on the server
2. Server builds a Solana v0 transaction, stores it, and pushes `tx_signing_request` over WebSocket
3. Server also sends an Expo push notification (for background/killed app)
4. `AgentProvider` receives the WS message → `AgentTxModal` appears
5. User taps **Sign & Send** → MWA opens the wallet for approval → signature returned to server
6. On WS reconnect the server re-delivers any non-expired pending requests automatically

## Package info

| Field | Value |
|---|---|
| Package name | `com.agentx.app` |
| EAS owner | `rohit0110` |
| Cluster | Solana Devnet |
