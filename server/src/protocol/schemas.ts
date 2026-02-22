import { z } from "zod";

// ---------------------------------------------------------------------------
// Inbound (client → server)
// ---------------------------------------------------------------------------

export const PromptPayloadSchema = z.object({
  prompt: z.string().min(1),
  session_id: z.string().optional(),
});

export const InboundPromptSchema = z.object({
  type: z.literal("prompt"),
  payload: PromptPayloadSchema,
});

export const InboundPingSchema = z.object({
  type: z.literal("ping"),
});

export const InboundMessageSchema = z.discriminatedUnion("type", [
  InboundPromptSchema,
  InboundPingSchema,
]);

// ---------------------------------------------------------------------------
// Outbound (server → client)
// ---------------------------------------------------------------------------

export const AgentDeltaSchema = z.object({
  type: z.literal("agent_delta"),
  payload: z.object({
    session_id: z.string(),
    text: z.string(),
  }),
});

export const AgentDoneSchema = z.object({
  type: z.literal("agent_done"),
  payload: z.object({
    session_id: z.string(),
    text: z.string(),
  }),
});

export const ToolCallSchema = z.object({
  type: z.literal("tool_call"),
  payload: z.object({
    session_id: z.string(),
    tool: z.string(),
    input: z.unknown(),
  }),
});

export const ToolResultSchema = z.object({
  type: z.literal("tool_result"),
  payload: z.object({
    session_id: z.string(),
    tool: z.string(),
    output: z.unknown(),
  }),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  payload: z.object({
    session_id: z.string(),
    message: z.string(),
  }),
});

export const PongSchema = z.object({
  type: z.literal("pong"),
});

export const OutboundMessageSchema = z.discriminatedUnion("type", [
  AgentDeltaSchema,
  AgentDoneSchema,
  ToolCallSchema,
  ToolResultSchema,
  ErrorMessageSchema,
  PongSchema,
]);

// ---------------------------------------------------------------------------
// REST schemas
// ---------------------------------------------------------------------------

export const PromptRequestSchema = z.object({
  prompt: z.string().min(1),
  session_id: z.string().optional(),
});

export const MessageSchema = z.object({
  id: z.number(),
  session_id: z.string(),
  role: z.enum(["user", "agent"]),
  content: z.string(),
  created_at: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred TS types
// ---------------------------------------------------------------------------

export type PromptPayload = z.infer<typeof PromptPayloadSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;
export type AgentDelta = z.infer<typeof AgentDeltaSchema>;
export type AgentDone = z.infer<typeof AgentDoneSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;
export type PromptRequest = z.infer<typeof PromptRequestSchema>;
export type Message = z.infer<typeof MessageSchema>;
