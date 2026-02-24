import { OutboundMessage } from "../protocol/schemas";

// Raw WebSocket shape — avoids importing 'ws' directly (it's a transitive dep)
type RawWS = {
  readyState: number;
  readonly OPEN: number;
  send(data: string): void;
};

/**
 * Singleton registry of all active WebSocket connections.
 * Used so server-initiated events (e.g. tx_signing_request) can be pushed
 * to every connected client without going through an HTTP request.
 */
class ClientRegistry {
  private clients = new Set<RawWS>();

  register(ws: RawWS): void {
    this.clients.add(ws);
  }

  unregister(ws: RawWS): void {
    this.clients.delete(ws);
  }

  broadcast(msg: OutboundMessage): void {
    const json = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(json);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

export const clientRegistry = new ClientRegistry();
