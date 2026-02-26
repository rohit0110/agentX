import EventEmitter from "events";
import { randomUUID } from "crypto";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { sql } from "../db/database";
import { readFileTool, writeFileTool } from "./tools/filesystem";
import {
  getSolanaPriceTool,
  createPriceAlertTool,
  queueSigningRequestTool,
  getPendingSigningRequestsTool,
} from "./tools/solana";

const SYSTEM_PROMPT = `You are agentX, an autonomous Solana trading agent running persistently alongside the user's mobile app.

## Supported swaps
ONLY SOL ↔ USDC swaps are supported. Never suggest or attempt any other token pair.

## Modes

CHAT — User talks to you directly.
- If they describe a strategy, call createPriceAlert, then confirm with the exact details:
  "Watching SOL — I'll swap [AMOUNT] [FROM] → [TO] when price goes [direction] $[target]."
- Never say generic phrases like "alert created" or "price check set up". Always echo the specifics.
- Keep responses short — the user is on mobile.
- If the user asks about unsupported tokens or pairs, explain that only SOL ↔ USDC is supported.

AUTONOMOUS — You are triggered by a [SYSTEM — price alert triggered] message.
- Call getSolanaPrice to confirm the current price before deciding anything.
- Call getPendingSigningRequests to avoid sending a duplicate if one is already waiting.
- If conditions look good, call queueSigningRequest.
- You MUST always end with a short plain-text message the user will see in chat:
  - If you queued a trade: state the token, the price it hit, and what you sent. E.g. "SOL hit $84.37 — signing request sent to your phone. Swapping 1 SOL → USDC."
  - If you decided not to trade: one sentence explaining why (duplicate pending, conditions changed, etc.)
- Never end silently after tool calls. Always produce at least one sentence of text.

## Tool templates — always follow these exactly

### createPriceAlert
Use when the user defines a trading strategy.
Required fields:
  token        — always "SOL" (only SOL price is watched)
  target_price — number, e.g. 150.00
  direction    — "above" | "below"
  from_token   — "SOL" or "USDC" (token to sell)
  to_token     — "SOL" or "USDC" (token to buy, must differ from from_token)
  amount       — positive number in from_token units

### queueSigningRequest
Use after you have decided a trade should happen. Never call without checking price first.
Required fields:
  from_token — "SOL" or "USDC"
  to_token   — "SOL" or "USDC" (must differ from from_token)
  amount     — positive number in from_token units
  reason     — MUST follow this format exactly:
               "SOL [hit/rose to] $[price] — [strategy context]. Swapping [amount] [from] → [to]."
               Examples:
               "SOL dropped to $142.30 — executing your buy-the-dip strategy. Swapping 1 SOL → USDC."
               "SOL rose to $210.00 — taking profit at your target. Swapping 50 USDC → SOL."

### getSolanaPrice
Call this before any trade decision. Supported tokens: SOL, USDC.

### getPendingSigningRequests
Call this before queueSigningRequest to check if a duplicate is already waiting.`;

export interface AgentRunnerEvents {
  agent_delta: (sessionId: string, text: string) => void;
  agent_done: (sessionId: string, text: string) => void;
  tool_call: (sessionId: string, tool: string, input: unknown) => void;
  tool_result: (sessionId: string, tool: string, output: unknown) => void;
  error: (sessionId: string, message: string) => void;
}

// Typed EventEmitter
export declare interface AgentRunner {
  on<K extends keyof AgentRunnerEvents>(event: K, listener: AgentRunnerEvents[K]): this;
  emit<K extends keyof AgentRunnerEvents>(
    event: K,
    ...args: Parameters<AgentRunnerEvents[K]>
  ): boolean;
}

export class AgentRunner extends EventEmitter {
  private queue: Array<{ sessionId: string; prompt: string }> = [];
  private running = false;

  enqueue(prompt: string, sessionId?: string): string {
    const sid = sessionId ?? randomUUID();
    this.queue.push({ sessionId: sid, prompt });
    this.drain();
    return sid;
  }

  private drain(): void {
    if (this.running || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.running = true;
    this.run(item.sessionId, item.prompt).finally(() => {
      this.running = false;
      this.drain();
    });
  }

  private async run(sessionId: string, prompt: string): Promise<void> {
    try {
      // Ensure session row exists
      await sql`
        INSERT INTO sessions (session_id)
        VALUES (${sessionId})
        ON CONFLICT (session_id) DO NOTHING
      `;

      // Persist user message
      await sql`
        INSERT INTO messages (session_id, role, content)
        VALUES (${sessionId}, 'user', ${prompt})
      `;

      // Fetch conversation history for context
      const history = await sql<{ role: string; content: string }[]>`
        SELECT role, content
        FROM messages
        WHERE session_id = ${sessionId}
        ORDER BY id ASC
      `;

      const messages = history.map((row) => ({
        role: row.role === "user" ? ("user" as const) : ("assistant" as const),
        content: row.content,
      }));

      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        system: SYSTEM_PROMPT,
        messages,
        maxSteps: 5,
        tools: {
          readFile: readFileTool,
          writeFile: writeFileTool,
          getSolanaPrice: getSolanaPriceTool,
          createPriceAlert: createPriceAlertTool,
          queueSigningRequest: queueSigningRequestTool,
          getPendingSigningRequests: getPendingSigningRequestsTool,
        },
      });

      // Consume fullStream and accumulate text as we go
      let fullText = "";
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          fullText += chunk.textDelta;
          this.emit("agent_delta", sessionId, chunk.textDelta);
        } else if (chunk.type === "tool-call") {
          console.log(`[AgentRunner] tool-call session=${sessionId} tool=${chunk.toolName}`);
          this.emit("tool_call", sessionId, chunk.toolName, chunk.args);
        } else if (chunk.type === "tool-result") {
          console.log(`[AgentRunner] tool-result session=${sessionId} tool=${chunk.toolName}`);
          this.emit("tool_result", sessionId, chunk.toolName, chunk.result);
        } else if (chunk.type === "step-finish") {
          console.log(`[AgentRunner] step-finish session=${sessionId} finishReason=${chunk.finishReason} text=${JSON.stringify(chunk.text?.slice(0, 60))}`);
        } else if (chunk.type === "error") {
          const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
          console.error(`[AgentRunner] stream error session=${sessionId}`, errMsg);
          this.emit("error", sessionId, errMsg);
          return;
        }
      }

      if (!fullText) {
        // Autonomous alert sessions (alert_X) legitimately produce no chat text —
        // the agent's output is the tx push, not a message. Suppress cleanly.
        // Chat sessions should always produce text per the system prompt; log a
        // warning if they don't so we can catch regressions.
        const isAutonomous = sessionId.startsWith("alert_");
        if (isAutonomous) {
          console.log(`[AgentRunner] autonomous session=${sessionId} completed (no chat text — tx push was the output)`);
        } else {
          console.warn(`[AgentRunner] session=${sessionId} produced empty text — check system prompt`);
          this.emit("agent_done", sessionId, "");
        }
        return;
      }

      // Persist agent response
      await sql`
        INSERT INTO messages (session_id, role, content)
        VALUES (${sessionId}, ${"agent"}, ${fullText})
      `;

      console.log(`[AgentRunner] done session=${sessionId} chars=${fullText.length}`);
      this.emit("agent_done", sessionId, fullText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AgentRunner] error session=${sessionId}`, message);
      this.emit("error", sessionId, message);
    }
  }
}

// Singleton
export const agentRunner = new AgentRunner();
