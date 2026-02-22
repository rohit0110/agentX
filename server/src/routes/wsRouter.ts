import { FastifyPluginAsync } from "fastify";
import { SocketStream } from "@fastify/websocket";
import { InboundMessageSchema, OutboundMessage } from "../protocol/schemas";
import { agentRunner } from "../agent/AgentRunner";

const API_KEY = process.env.API_KEY ?? "change_me";

function send(stream: SocketStream, msg: OutboundMessage): void {
  const ws = stream.socket;
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const wsRouter: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/ws",
    { websocket: true },
    (socket, req) => {
      // Auth check on upgrade
      if (req.headers["x-api-key"] !== API_KEY) {
        socket.socket.close(1008, "Unauthorized");
        return;
      }

      console.log("[ws] client connected");

      // Forward agent events to this socket
      const onDelta = (sessionId: string, text: string) => {
        send(socket, { type: "agent_delta", payload: { session_id: sessionId, text } });
      };
      const onDone = (sessionId: string, text: string) => {
        send(socket, { type: "agent_done", payload: { session_id: sessionId, text } });
      };
      const onToolCall = (sessionId: string, tool: string, input: unknown) => {
        send(socket, { type: "tool_call", payload: { session_id: sessionId, tool, input } });
      };
      const onToolResult = (sessionId: string, tool: string, output: unknown) => {
        send(socket, { type: "tool_result", payload: { session_id: sessionId, tool, output } });
      };
      const onError = (sessionId: string, message: string) => {
        send(socket, { type: "error", payload: { session_id: sessionId, message } });
      };

      agentRunner.on("agent_delta", onDelta);
      agentRunner.on("agent_done", onDone);
      agentRunner.on("tool_call", onToolCall);
      agentRunner.on("tool_result", onToolResult);
      agentRunner.on("error", onError);

      socket.socket.on("message", (raw: Buffer) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          send(socket, {
            type: "error",
            payload: { session_id: "", message: "Invalid JSON" },
          });
          return;
        }

        const result = InboundMessageSchema.safeParse(parsed);
        if (!result.success) {
          send(socket, {
            type: "error",
            payload: { session_id: "", message: "Unknown or malformed message type" },
          });
          return;
        }

        const msg = result.data;
        if (msg.type === "ping") {
          send(socket, { type: "pong" });
          return;
        }

        if (msg.type === "prompt") {
          const { prompt, session_id } = msg.payload;
          agentRunner.enqueue(prompt, session_id);
        }
      });

      socket.socket.on("close", () => {
        console.log("[ws] client disconnected");
        agentRunner.off("agent_delta", onDelta);
        agentRunner.off("agent_done", onDone);
        agentRunner.off("tool_call", onToolCall);
        agentRunner.off("tool_result", onToolResult);
        agentRunner.off("error", onError);
      });

      socket.socket.on("error", (err: Error) => {
        console.error("[ws] socket error", err.message);
      });
    }
  );
};

export default wsRouter;
