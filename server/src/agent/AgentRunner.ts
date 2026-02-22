import EventEmitter from "events";
import { randomUUID } from "crypto";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { sql } from "../db/database";
import { readFileTool, writeFileTool } from "./tools/filesystem";
import { getSolanaPriceTool, buildMockSwapTxTool } from "./tools/solana";

const SYSTEM_PROMPT = `You are OpenClaw, a Solana trading assistant agent.
You help users understand token prices, build swap strategies, and prepare trade transactions.
Be concise and actionable. Use tools when you need real data or to build transactions.
Always explain what you're doing before calling a tool.`;

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
          buildMockSwapTx: buildMockSwapTxTool,
        },
      });

      // Consume fullStream and accumulate text as we go
      let fullText = "";
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          fullText += chunk.textDelta;
          this.emit("agent_delta", sessionId, chunk.textDelta);
        } else if (chunk.type === "tool-call") {
          this.emit("tool_call", sessionId, chunk.toolName, chunk.args);
        } else if (chunk.type === "tool-result") {
          this.emit("tool_result", sessionId, chunk.toolName, chunk.result);
        }
      }

      const text = fullText;

      // Persist agent response
      await sql`
        INSERT INTO messages (session_id, role, content)
        VALUES (${sessionId}, ${"agent"}, ${text})
      `;

      console.log(`[AgentRunner] done session=${sessionId} chars=${text.length}`);
      this.emit("agent_done", sessionId, text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AgentRunner] error session=${sessionId}`, message);
      this.emit("error", sessionId, message);
    }
  }
}

// Singleton
export const agentRunner = new AgentRunner();
